import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { supabase } from '../lib/supabase';

type Task = {
  name: string;
  location: string;
  done: boolean;
  fake: boolean;
};

type Player = {
  id: string;
  display_name: string;
  color: string;
  role: string;
  is_alive: boolean;
  is_host: boolean;
  tasks: Task[];
  last_kill_at: string | null;
};

type Room = {
  id: string;
  status: string;
  winner: string | null;
  settings: {
    task_visibility?: string;
    kill_cooldown?: number;
  };
};

function GlobalTaskBar({ players, visibility, isMeeting }: { players: Player[]; visibility?: string; isMeeting: boolean }) {
  const crewPlayers = players.filter((p) => p.role !== 'impostor' && p.role !== 'jester');
  const totalTasks = crewPlayers.reduce((sum, p) => sum + p.tasks.length, 0);
  const completedTasks = crewPlayers.reduce((sum, p) => sum + p.tasks.filter((t) => t.done).length, 0);
  const percent = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const shouldShow = visibility === 'Always' || (visibility === 'Meetings' && isMeeting);

  if (!shouldShow) return null;

  return (
    <View style={styles.taskBarContainer}>
      <View style={styles.taskBarTrack}>
        <View style={[styles.taskBarFill, { width: `${percent * 100}%` }]} />
      </View>
    </View>
  );
}

export default function GameScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState<Room | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);

  const [confirmingDeath, setConfirmingDeath] = useState(false);
  const [needsKillerSelection, setNeedsKillerSelection] = useState(false);
  const [killerSelected, setKillerSelected] = useState(false);
  const [cooldownTick, setCooldownTick] = useState(0);

  const playerRef = useRef<Player | null>(null);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useHeartbeat(playerId);

  useEffect(() => {
    // Reset any leftover UI state from a previous game
    setConfirmingDeath(false);
    setNeedsKillerSelection(false);
    setKillerSelected(false);
    setLoading(true);

    fetchPlayer();
    fetchRoomAndPlayers();

    const playerChannel = supabase
      .channel(`player:${playerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `id=eq.${playerId}` },
        (payload) => {
          if (payload.new) setPlayer(payload.new as Player);
        }
      )
      .subscribe();

    const roomChannel = supabase
      .channel(`game-room:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
        () => fetchRoomAndPlayers()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.new) {
            const updatedRoom = payload.new as Room;
            setRoom(updatedRoom);
            if (updatedRoom.status === 'meeting') {
              router.replace(`/gathering?roomId=${roomId}&playerId=${playerId}`);
            } else if (updatedRoom.status === 'ended') {
              router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, playerId]);

  // Tick every second to keep the kill cooldown display updating
  useEffect(() => {
    const interval = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchPlayer = async () => {
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (data) {
      setPlayer(data);
      if (!data.is_alive) {
        checkIfKillerAlreadySelected();
      }
    }
    setLoading(false);
  };

  const fetchRoomAndPlayers = async () => {
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId);

    if (roomData) setRoom(roomData);
    if (playersData) {
      setAllPlayers(playersData);
      checkTaskWinCondition(roomData, playersData);
    }
  };

  const checkIfKillerAlreadySelected = async () => {
    const { data } = await supabase
      .from('kills')
      .select('id')
      .eq('victim_id', playerId)
      .maybeSingle();

    if (data) {
      setKillerSelected(true);
      setNeedsKillerSelection(false);
    } else {
      setNeedsKillerSelection(true);
    }
  };

  // Only the host writes the win condition, to avoid duplicate/race writes
  const checkTaskWinCondition = async (roomData: Room | null, playersList: Player[]) => {
    const currentPlayer = playerRef.current;
    if (!currentPlayer?.is_host) return;
    if (!roomData || roomData.status === 'ended') return;

    const livingCrew = playersList.filter(
      (p) => p.is_alive && p.role !== 'impostor' && p.role !== 'jester'
    );
    if (livingCrew.length === 0) return;

    const allDone = livingCrew.every((p) => p.tasks.every((t) => t.done));
    if (allDone) {
      await supabase
        .from('rooms')
        .update({ status: 'ended', winner: 'crewmate' })
        .eq('id', roomId);
    }
  };

  const toggleTask = async (index: number) => {
    if (!player) return;
    const updatedTasks = [...player.tasks];
    updatedTasks[index] = { ...updatedTasks[index], done: !updatedTasks[index].done };

    await supabase
      .from('players')
      .update({ tasks: updatedTasks })
      .eq('id', playerId);
  };

  const handleTriggerMeeting = async (triggerType: 'report' | 'emergency') => {
    const { data: meeting, error } = await supabase
      .from('meetings')
      .insert({
        room_id: roomId,
        triggered_by: playerId,
        trigger_type: triggerType,
        status: 'discussion',
      })
      .select()
      .single();

    if (error || !meeting) {
      console.error('Failed to create meeting', error);
      return;
    }

    await supabase
      .from('rooms')
      .update({ status: 'meeting' })
      .eq('id', roomId);
  };

  const getKillCooldownRemaining = () => {
    if (!player?.last_kill_at) return 0;
    const killCooldownSeconds = room?.settings.kill_cooldown ?? 30;
    const lastKill = new Date(player.last_kill_at).getTime();
    const cooldownMs = killCooldownSeconds * 1000;
    const elapsed = Date.now() - lastKill;
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    return remaining > 0 ? remaining : 0;
  };

  const handleKillTap = async () => {
    await supabase
      .from('players')
      .update({ last_kill_at: new Date().toISOString() })
      .eq('id', playerId);
  };

  const handleIWasKilledTap = () => {
    setConfirmingDeath(true);
  };

  const cancelDeath = () => {
    setConfirmingDeath(false);
  };

  const confirmDeath = async () => {
    setConfirmingDeath(false);
    await supabase
      .from('players')
      .update({ is_alive: false })
      .eq('id', playerId);

    setNeedsKillerSelection(true);
  };

  const selectKiller = async (killerId: string) => {
    await supabase.from('kills').insert({
      room_id: roomId,
      killer_id: killerId,
      victim_id: playerId,
    });

    setNeedsKillerSelection(false);
    setKillerSelected(true);
  };

  if (loading || !player) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  // Dead player view: killer selection first (if not done yet), then spectate screen
  if (!player.is_alive) {
    if (needsKillerSelection && !killerSelected) {
      const livingOthers = allPlayers.filter((p) => p.is_alive && p.id !== playerId && p.role === 'impostor');
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Who killed you?</Text>
          <Text style={styles.progress}>This is private — only used for the end-game summary.</Text>
          <View style={styles.taskList}>
            {livingOthers.map((p) => (
              <TouchableOpacity key={p.id} style={styles.taskRow} onPress={() => selectKiller(p.id)}>
                <Text style={styles.taskName}>{p.display_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      );
    }

    return (
      <View style={styles.centered}>
        <Text style={styles.deadTitle}>You're Dead</Text>
        <Text style={styles.deadSubtitle}>Spectating — you can no longer complete tasks or trigger meetings.</Text>
      </View>
    );
  }

  const isImpostor = player.role === 'impostor';
  const isImpostorOrJester = player.role === 'impostor' || player.role === 'jester';
  const completedCount = player.tasks.filter((t) => t.done).length;
  const cooldownRemaining = getKillCooldownRemaining();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <GlobalTaskBar
        players={allPlayers}
        visibility={room?.settings.task_visibility}
        isMeeting={false}
      />
      <Text style={styles.title}>
        {isImpostorOrJester ? 'Fake Tasks' : 'Your Tasks'}
      </Text>
      <Text style={styles.progress}>{completedCount}/{player.tasks.length} completed</Text>

      <View style={styles.taskList}>
        {player.tasks.map((task, index) => (
          <TouchableOpacity key={index} style={styles.taskRow} onPress={() => toggleTask(index)}>
            <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
              {task.done && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskName, task.done && styles.taskNameDone]}>{task.name}</Text>
              <Text style={styles.taskLocation}>📍 {task.location}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleTriggerMeeting('report')}
        >
          <Text style={styles.actionButtonText}>Report Body</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.emergencyButton]}
          onPress={() => handleTriggerMeeting('emergency')}
        >
          <Text style={styles.actionButtonText}>Emergency Meeting</Text>
        </TouchableOpacity>

        {isImpostor ? (
          <TouchableOpacity
            style={[styles.actionButton, styles.killButton, cooldownRemaining > 0 && styles.killButtonDisabled]}
            onPress={handleKillTap}
            disabled={cooldownRemaining > 0}
          >
            <Text style={[styles.actionButtonText, cooldownRemaining > 0 && styles.killButtonTextDisabled]}>
              {cooldownRemaining > 0 ? `Kill (${cooldownRemaining}s)` : 'Kill'}
            </Text>
          </TouchableOpacity>
        ) : confirmingDeath ? (
          <View style={styles.confirmRow}>
            <TouchableOpacity style={[styles.actionButton, styles.killButton, { flex: 1 }]} onPress={confirmDeath}>
              <Text style={styles.actionButtonText}>Confirm - I'm Dead</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { flex: 1 }]} onPress={cancelDeath}>
              <Text style={styles.actionButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, styles.killButton]}
            onPress={handleIWasKilledTap}
          >
            <Text style={styles.actionButtonText}>I Was Killed</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  progress: {
    color: '#aaaaaa',
    fontSize: 14,
    marginBottom: 20,
  },
  deadTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginBottom: 12,
  },
  deadSubtitle: {
    color: '#aaaaaa',
    fontSize: 14,
    textAlign: 'center',
  },
  taskList: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    gap: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#2ecc71',
    borderColor: '#2ecc71',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  taskName: {
    color: '#ffffff',
    fontSize: 16,
  },
  taskNameDone: {
    color: '#777',
    textDecorationLine: 'line-through',
  },
  taskBarContainer: {
    width: '100%',
    marginBottom: 20,
  },
  taskBarTrack: {
    height: 12,
    backgroundColor: '#16213e',
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  taskBarFill: {
    height: '100%',
    backgroundColor: '#2ecc71',
  },
  taskBarLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  taskLocation: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  actionButtons: {
    marginTop: 24,
    gap: 12,
  },
  actionButton: {
    backgroundColor: '#16213e',
    borderWidth: 2,
    borderColor: '#e74c3c',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  emergencyButton: {
    borderColor: '#f1c40f',
  },
  killButton: {
    borderColor: '#e74c3c',
    backgroundColor: '#2a1520',
  },
  killButtonDisabled: {
    borderColor: '#555',
    backgroundColor: '#1e1e2e',
    opacity: 0.7,
  },
  killButtonTextDisabled: {
    color: '#888',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});