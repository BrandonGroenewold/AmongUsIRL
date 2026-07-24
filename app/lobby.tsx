import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SettingsModal from '../components/SettingsModal';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useHostFailover } from '../hooks/useHostFailover';
import { clearSession } from '../lib/session';
import { supabase } from '../lib/supabase';

const DISCONNECTED_THRESHOLD_MS = 20000;

function isDisconnected(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() > DISCONNECTED_THRESHOLD_MS;
}

type Player = {
  id: string;
  display_name: string;
  color: string;
  is_host: boolean;
  last_seen: string;
  created_at: string;
  device_id: string | null;
};

type Room = {
  id: string;
  code: string;
  host_id: string;
  status: string;
  banned_device_ids?: string[];
  settings: {
    impostor_count?: number;
    task_count?: number;
    kill_cooldown?: number;
    discussion_time?: number;
    voting_time?: number;
    role_reveal?: boolean;
    emergency_meetings?: number;
    task_visibility?: string;
    tasks?: { name: string; location: string }[];
    jester_enabled?: boolean;
    scientist_enabled?: boolean;
    vitals_duration?: number;
    anonymous_voting?: boolean;
    gathering_time?: number;
  };
};

export default function LobbyScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showManagePlayers, setShowManagePlayers] = useState(false);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 20000); // 20s — lobby has no legitimate reason for a long gap

  const isHost = room?.host_id === playerId;

useFocusEffect(
    useCallback(() => {
      // Fresh fetch + fresh subscription every time this screen gains focus, including
      // the second visit after Play Again — matches the pattern used in meeting.tsx/game.tsx
      setLoading(true);
      fetchData();

      const channel = supabase
        .channel(`room:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
          () => fetchData()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
          (payload) => {
            if (payload.new) {
              const updatedRoom = payload.new as Room;
              setRoom(updatedRoom);
              if (updatedRoom.status === 'in_progress') {
                router.replace(`/role-reveal?roomId=${roomId}&playerId=${playerId}`);
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [roomId, playerId])
  );

  const fetchData = async () => {
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (roomData) setRoom(roomData);
    if (playersData) {
      setPlayers(playersData);

      // If this device's own player row is gone, we were kicked or banned — leave immediately
      // rather than sitting on a stale screen with a playerId that no longer exists
      const stillInRoom = playersData.some((p) => p.id === playerId);
      if (!stillInRoom) {
        await clearSession();
        router.replace('/');
        return;
      }
    }
    setLoading(false);
  };

const handleLeave = async () => {
    if (isHost) {
      const nextHost = players
        .filter((p) => p.id !== playerId && !isDisconnected(p.last_seen))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

      if (nextHost) {
        await supabase.from('players').update({ is_host: true }).eq('id', nextHost.id);
        await supabase.from('rooms').update({ host_id: nextHost.id }).eq('id', roomId);
      }
    }

     const { error: deleteError } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId);
    if (deleteError) {
      console.error('Failed to delete player row on leave:', deleteError);
    }
    await clearSession();
    router.replace('/');
  };

const handlePromoteHost = async (newHostId: string) => {
    await supabase.from('players').update({ is_host: false }).eq('id', playerId);
    await supabase.from('players').update({ is_host: true }).eq('id', newHostId);
    await supabase.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
  };

  const handleKickPlayer = async (targetId: string) => {
    await supabase.from('players').delete().eq('id', targetId);
  };

  const handleBanPlayer = async (targetId: string, targetDeviceId: string | null) => {
    if (targetDeviceId) {
      const currentBanned = room?.banned_device_ids ?? [];
      await supabase
        .from('rooms')
        .update({ banned_device_ids: [...currentBanned, targetDeviceId] })
        .eq('id', roomId);
    }
    await supabase.from('players').delete().eq('id', targetId);
  };

  const handleSaveSettings = async (newSettings: any) => {
    await supabase
      .from('rooms')
      .update({ settings: newSettings })
      .eq('id', roomId);
    setShowSettings(false);
  };

  const handleStartGame = async () => {
    const taskCount = room?.settings.task_count ?? 3;
    const taskPool = room?.settings.tasks ?? [];
    const impostorCount = room?.settings.impostor_count ?? 1;

  const activePlayers = players.filter((p) => !isDisconnected(p.last_seen));

    if (activePlayers.length < 4) {
      alert('You need at least 4 connected players to start.');
      return;
    }

    if (taskPool.length < taskCount) {
      alert(`You need at least ${taskCount} tasks in the task pool before starting.`);
      return;
    }

    const jesterEnabled = room?.settings.jester_enabled ?? false;
    const scientistEnabled = room?.settings.scientist_enabled ?? false;

    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    const roles: Record<string, string> = {};

    shuffledPlayers.forEach((player, index) => {
      if (index < impostorCount) {
        roles[player.id] = 'impostor';
      }
    });

    const nonImpostors = shuffledPlayers.slice(impostorCount);
    let nonImpostorIndex = 0;

    if (scientistEnabled && nonImpostors.length > 0) {
      roles[nonImpostors[nonImpostorIndex].id] = 'scientist';
      nonImpostorIndex++;
    }

    if (jesterEnabled && nonImpostorIndex < nonImpostors.length) {
      roles[nonImpostors[nonImpostorIndex].id] = 'jester';
      nonImpostorIndex++;
    }

    nonImpostors.slice(nonImpostorIndex).forEach((player) => {
      roles[player.id] = 'crewmate';
    });

    const shuffleTasks = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);

    const updates = players.map((player) => {
      const role = roles[player.id];
      const assignedTasks = role === 'impostor'
        ? shuffleTasks(taskPool).slice(0, taskCount).map((t: any) => ({ ...t, done: false, fake: true }))
        : shuffleTasks(taskPool).slice(0, taskCount).map((t: any) => ({ ...t, done: false, fake: false }));

      return supabase
        .from('players')
        .update({ role: role, tasks: assignedTasks })
        .eq('id', player.id);
    });

    await Promise.all(updates);

    await supabase
      .from('rooms')
      .update({ status: 'in_progress' })
      .eq('id', roomId);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Lobby</Text>

      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>Room Code</Text>
        <Text style={styles.code}>{room?.code}</Text>
      </View>

      <Text style={styles.sectionLabel}>Players ({players.length})</Text>
      <View style={styles.playerList}>
        {players.map((player) => {
          const disconnected = isDisconnected(player.last_seen);
          return (
            <View key={player.id} style={styles.playerRow}>
              <View style={[styles.colorDot, { backgroundColor: getColorHex(player.color) }, disconnected && styles.colorDotDisconnected]} />
              <Text style={[styles.playerName, disconnected && styles.playerNameDisconnected]}>
                {player.display_name}
              </Text>
              {disconnected && <Text style={styles.disconnectedBadge}>DISCONNECTED</Text>}
              {player.is_host && <Text style={styles.hostBadge}>HOST</Text>}
              {isHost && !player.is_host && !disconnected && (
                <TouchableOpacity onPress={() => handlePromoteHost(player.id)} style={styles.makeHostButton}>
                  <Text style={styles.makeHostText}>Make Host</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <TouchableOpacity onPress={() => isHost && setShowSettings(true)} disabled={!isHost}>
        <Text style={styles.sectionLabel}>
          Game Settings {isHost && <Text style={styles.editHint}>✎ Edit</Text>}
        </Text>
      </TouchableOpacity>
      <View style={styles.settingsBox}>
        <SettingRow label="Impostors" value={room?.settings.impostor_count ?? 1} isHost={isHost} />
        <SettingRow label="Tasks per player" value={room?.settings.task_count ?? 3} isHost={isHost} />
        <SettingRow label="Kill cooldown" value={`${room?.settings.kill_cooldown ?? 30}s`} isHost={isHost} />
        <SettingRow label="Gathering time" value={`${room?.settings.gathering_time ?? 45}s`} isHost={isHost} />
        <SettingRow label="Discussion time" value={`${room?.settings.discussion_time ?? 60}s`} isHost={isHost} />
        <SettingRow label="Voting time" value={`${room?.settings.voting_time ?? 60}s`} isHost={isHost} />
        <SettingRow label="Emergency meetings" value={room?.settings.emergency_meetings ?? 1} isHost={isHost} />
        <SettingRow label="Role reveal on eject" value={room?.settings.role_reveal ? 'On' : 'Off'} isHost={isHost} />
        <SettingRow label="Task visibility" value={room?.settings.task_visibility ?? 'Meetings'} isHost={isHost} />
      </View>

      {isHost && (
        <TouchableOpacity onPress={() => setShowManagePlayers(true)} style={styles.manageButton}>
          <Text style={styles.manageButtonText}>Manage Players</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={handleLeave} style={styles.backButton}>
        <Text style={styles.backText}>Leave Lobby</Text>
      </TouchableOpacity>

      {isHost && (
        <TouchableOpacity style={styles.startButton} onPress={handleStartGame}>
          <Text style={styles.startButtonText}>Start Game</Text>
        </TouchableOpacity>
      )}

      {!isHost && (
        <Text style={styles.waitingText}>Waiting for host to start the game...</Text>
      )}

<SettingsModal
        visible={showSettings}
        settings={room?.settings ?? {}}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />

      <Modal visible={showManagePlayers} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Manage Players</Text>
            <ScrollView style={styles.modalList}>
              {players.filter((p) => p.id !== playerId).map((p) => (
                <View key={p.id} style={styles.modalRow}>
                  <View style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]} />
                  <Text style={styles.modalPlayerName}>{p.display_name}</Text>
                  <TouchableOpacity onPress={() => handleKickPlayer(p.id)} style={styles.kickButton}>
                    <Text style={styles.kickButtonText}>Kick</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleBanPlayer(p.id, p.device_id)} style={styles.banButton}>
                    <Text style={styles.banButtonText}>Ban</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity onPress={() => setShowManagePlayers(false)} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SettingRow({ label, value, isHost }: { label: string; value: any; isHost: boolean }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{value}</Text>
    </View>
  );
}

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c', Blue: '#3498db', Green: '#2ecc71',
    Purple: '#9b59b6', Yellow: '#f1c40f', Orange: '#e67e22',
    Pink: '#fd79a8', Cyan: '#00cec9', White: '#dfe6e9', Brown: '#a0522d',
  };
  return map[colorName] ?? '#888';
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 24,
    textAlign: 'center',
  },
  codeBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  codeLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  code: {
    color: '#e74c3c',
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 8,
  },
  sectionLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  editHint: {
    color: '#e74c3c',
  },
  playerList: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  colorDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 12,
  },
  playerName: {
    color: '#ffffff',
    fontSize: 16,
    flex: 1,
  },
hostBadge: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  makeHostButton: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e74c3c',
  },
  makeHostText: {
    color: '#e74c3c',
    fontSize: 11,
    fontWeight: 'bold',
  },
  colorDotDisconnected: {
    opacity: 0.3,
  },
  playerNameDisconnected: {
    color: '#666',
  },
  disconnectedBadge: {
    color: '#666',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginRight: 8,
  },
  settingsBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  settingLabel: {
    color: '#aaaaaa',
    fontSize: 15,
  },
  settingValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  startButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  waitingText: {
    color: '#aaaaaa',
    textAlign: 'center',
    fontSize: 15,
  },
  backButton: {
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: '#aaaaaa',
    fontSize: 16,
  },
  manageButton: {
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e74c3c',
    borderRadius: 8,
    paddingVertical: 12,
  },
  manageButtonText: {
    color: '#e74c3c',
    fontSize: 15,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalList: {
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalPlayerName: {
    color: '#ffffff',
    fontSize: 15,
    flex: 1,
    marginLeft: 10,
  },
  kickButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e74c3c',
    marginRight: 6,
  },
  kickButtonText: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
  },
  banButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#888',
  },
  banButtonText: {
    color: '#888',
    fontSize: 12,
    fontWeight: 'bold',
  },
  modalCloseButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  modalCloseText: {
    color: '#aaaaaa',
    fontSize: 15,
  },
});