import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RoleRevealButton from '../components/RoleRevealButton';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useHostFailover } from '../hooks/useHostFailover';
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
  last_seen: string;
  created_at: string;
  vitals_charge_seconds?: number;
};

type Room = {
  id: string;
  status: string;
  winner: string | null;
  settings: {
    task_visibility?: string;
    kill_cooldown?: number;
    vitals_seconds_per_task?: number;
    vitals_min_open_cost?: number;
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

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c', Blue: '#3498db', Green: '#2ecc71',
    Purple: '#9b59b6', Yellow: '#f1c40f', Orange: '#e67e22',
    Pink: '#fd79a8', Cyan: '#00cec9', White: '#dfe6e9', Brown: '#a0522d',
  };
  return map[colorName] ?? '#888';
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
  const [vitalsOpen, setVitalsOpen] = useState(false);
  const [vitalsSecondsLeft, setVitalsSecondsLeft] = useState(0);
  const [pendingTaskIndex, setPendingTaskIndex] = useState<number | null>(null);
  const vitalsOpenedWithRef = useRef(0);
  const vitalsRemainingRef = useRef(0);

 const playerRef = useRef<Player | null>(null);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  // Mirror these in refs too, since the room-status realtime handler below is set up once
  // per focus (inside useFocusEffect) and would otherwise see stale values from whenever
  // the subscription was created, not the latest state
  const needsKillerSelectionRef = useRef(false);
  useEffect(() => {
    needsKillerSelectionRef.current = needsKillerSelection;
  }, [needsKillerSelection]);

  const killerSelectedRef = useRef(false);
  useEffect(() => {
    killerSelectedRef.current = killerSelected;
  }, [killerSelected]);

  const finalReportTimerStarted = useRef(false);
  const [finalReportSecondsLeft, setFinalReportSecondsLeft] = useState(15);

  useHeartbeat(playerId);
  useHostFailover(roomId, allPlayers, playerId);

  useFocusEffect(
    useCallback(() => {
      // Reset any leftover UI state from a previous visit to this screen
      setConfirmingDeath(false);
      setNeedsKillerSelection(false);
      setKillerSelected(false);
      setVitalsOpen(false);
      setVitalsSecondsLeft(0);
      setPendingTaskIndex(null);
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
                // If I still need to report who killed me, stay put — the killer-selection
                // screen's own countdown handles routing to end-game once I answer or time runs out
                const iStillNeedToReport = needsKillerSelectionRef.current && !killerSelectedRef.current;
                if (!iStillNeedToReport) {
                  router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
                }
              }
            }
          }
        )
        .subscribe();

      // Runs when the screen loses focus (navigates away) — tears down subscriptions
      // so a stale, hidden instance doesn't keep listening in the background
      return () => {
        supabase.removeChannel(playerChannel);
        supabase.removeChannel(roomChannel);
      };
    }, [roomId, playerId])
  );

  // Tick every second to keep the kill cooldown display updating
  // Tick every second to keep the kill cooldown display updating
  useEffect(() => {
    const interval = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Vitals countdown — only ticks while the modal is open, stops when closed or hits 0
  useEffect(() => {
    if (!vitalsOpen) return;

    const interval = setInterval(() => {
      vitalsRemainingRef.current -= 1;
      setVitalsSecondsLeft(vitalsRemainingRef.current);

      if (vitalsRemainingRef.current <= 0) {
        clearInterval(interval);
        setVitalsOpen(false);
        supabase.from('players').update({ vitals_charge_seconds: 0 }).eq('id', playerId);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [vitalsOpen]);

  // If our own death is the one that just ended the game, give a bounded 15s window to
  // report who killed us before routing to end-game — otherwise the redirect gating above
  // would leave us stuck on the killer-selection screen waiting on nothing
  useEffect(() => {
    const shouldCountDown = room?.status === 'ended' && needsKillerSelection && !killerSelected;

    if (!shouldCountDown) {
      finalReportTimerStarted.current = false;
      setFinalReportSecondsLeft(15);
      return;
    }

    if (finalReportTimerStarted.current) return;
    finalReportTimerStarted.current = true;

    let remaining = 15;
    setFinalReportSecondsLeft(remaining);

    const interval = setInterval(() => {
      remaining -= 1;
      setFinalReportSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.status, needsKillerSelection, killerSelected, roomId, playerId]);

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

if (roomData) {
      setRoom(roomData);
      // Catch reconnecting after the room already moved on — don't wait for a future update
      if (roomData.status === 'meeting') {
        router.replace(`/gathering?roomId=${roomId}&playerId=${playerId}`);
        return;
      }
      if (roomData.status === 'ended') {
        // Same gating as the rooms-table handler above — don't yank someone off the
        // killer-selection screen if they still need to report who killed them
        const iStillNeedToReport = needsKillerSelectionRef.current && !killerSelectedRef.current;
        if (!iStillNeedToReport) {
          router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
          return;
        }
      }
    }
if (playersData) {
      setAllPlayers(playersData);
      checkTaskWinCondition(roomData, playersData);
      checkEliminationWinCondition(playersData);
    }
  };
  const checkIfKillerAlreadySelected = async () => {
    // If this player was voted out, there's no killer to select — skip straight to spectating
    const { data: ejectionMeeting } = await supabase
      .from('meetings')
      .select('id')
      .eq('room_id', roomId)
      .eq('ejected_player_id', playerId)
      .maybeSingle();

    if (ejectionMeeting) {
      setKillerSelected(true);
      setNeedsKillerSelection(false);
      return;
    }

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

  // Same elimination-ratio logic meeting.tsx uses after a vote — but this fires after a KILL,
  // since a kill can also flip the win condition and nothing was previously checking for that here
  const checkEliminationWinCondition = async (playersList: Player[]) => {
    const currentPlayer = playerRef.current;
    if (!currentPlayer?.is_host) return;

    const livingPlayers = playersList.filter((p) => p.is_alive);
    const livingImpostors = livingPlayers.filter((p) => p.role === 'impostor');
    const livingNonImpostors = livingPlayers.filter((p) => p.role !== 'impostor');

    let winner: string | null = null;
    if (livingImpostors.length === 0) {
      winner = 'crewmate';
    } else if (livingImpostors.length >= livingNonImpostors.length) {
      winner = 'impostor';
    }

    if (winner) {
      await supabase
        .from('rooms')
        .update({ status: 'ended', winner })
        .eq('id', roomId);
    }
  };

  const toggleTask = (index: number) => {
    if (!player) return;
    if (player.tasks[index].done) return; // locked — can't uncheck
    setPendingTaskIndex(index);
  };

  const confirmTask = async () => {
    if (pendingTaskIndex === null || !player) return;
    const index = pendingTaskIndex;
    setPendingTaskIndex(null);

    const updatedTasks = [...player.tasks];
    updatedTasks[index] = { ...updatedTasks[index], done: true };

    const updates: any = { tasks: updatedTasks };

    // Scientist completing a real task earns vitals charge
    if (player.role === 'scientist' && !player.tasks[index].fake) {
      const secondsPerTask = room?.settings.vitals_seconds_per_task ?? 10;
      const currentCharge = player.vitals_charge_seconds ?? 0;
      updates.vitals_charge_seconds = currentCharge + secondsPerTask;
    }

    await supabase
      .from('players')
      .update(updates)
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

  const openVitals = () => {
    const currentCharge = player?.vitals_charge_seconds ?? 0;
    if (currentCharge <= 0) return;
    vitalsOpenedWithRef.current = currentCharge;
    vitalsRemainingRef.current = currentCharge;
    setVitalsSecondsLeft(currentCharge);
    setVitalsOpen(true);
  };

  const closeVitals = async () => {
    setVitalsOpen(false);
    const remaining = vitalsRemainingRef.current;
    const openedWith = vitalsOpenedWithRef.current;
    const minCost = room?.settings.vitals_min_open_cost ?? 3;
    const consumed = openedWith - remaining;
    // Enforce minimum open cost — can't peek for free by closing instantly
    const actualRemaining = consumed >= minCost
      ? remaining
      : Math.max(0, openedWith - minCost);

    await supabase
      .from('players')
      .update({ vitals_charge_seconds: actualRemaining })
      .eq('id', playerId);
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
      reported_by: playerId,
    });

    setNeedsKillerSelection(false);
    setKillerSelected(true);

    // If the game already ended on this kill, we were only still here to report —
    // head to end-game now instead of waiting on the countdown to run out
    if (room?.status === 'ended') {
      router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
    }
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
      const isFinalReport = room?.status === 'ended';
      const livingOthers = allPlayers.filter((p) => p.is_alive && p.id !== playerId && p.role === 'impostor');
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Who eliminated you?</Text>
          {isFinalReport ? (
            <Text style={styles.progress}>
              The game just ended — you have {finalReportSecondsLeft}s to report before moving on.
            </Text>
          ) : (
            <Text style={styles.progress}>This is private — only used for the end-game summary.</Text>
          )}
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
          <RoleRevealButton displayName={player.display_name} role={player.role} color={player.color} />
          <Text style={styles.deadTitle}>You've Been Eliminated</Text>
        <Text style={styles.deadSubtitle}>Spectating — you can no longer complete assignments or trigger debriefs.</Text>
      </View>
    );
  }

  const isImpostor = player.role === 'impostor';
  const isImpostorOrJester = player.role === 'impostor' || player.role === 'jester';
  const isScientist = player.role === 'scientist';
  const completedCount = player.tasks.filter((t) => t.done).length;
  const cooldownRemaining = getKillCooldownRemaining();

  return (
    <ScrollView contentContainerStyle={styles.container}>
    <GlobalTaskBar
        players={allPlayers}
        visibility={room?.settings.task_visibility}
        isMeeting={false}
      />
   <RoleRevealButton displayName={player.display_name} role={player.role} color={player.color} />
      <Text style={styles.title}>
        {isImpostorOrJester ? 'Fake Assignments' : 'Your Assignments'}
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
          <Text style={styles.actionButtonText}>Emergency Debrief</Text>
        </TouchableOpacity>

        {isImpostor ? (
          <TouchableOpacity
            style={[styles.actionButton, styles.killButton, cooldownRemaining > 0 && styles.killButtonDisabled]}
            onPress={handleKillTap}
            disabled={cooldownRemaining > 0}
          >
            <Text style={[styles.actionButtonText, cooldownRemaining > 0 && styles.killButtonTextDisabled]}>
              {cooldownRemaining > 0 ? `Burn (${cooldownRemaining}s)` : 'Burn'}
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
          <>
            {isScientist && (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  styles.vitalsButton,
                  (player.vitals_charge_seconds ?? 0) === 0 && styles.vitalsButtonDisabled,
                ]}
                onPress={openVitals}
                disabled={(player.vitals_charge_seconds ?? 0) === 0}
              >
                <Text style={styles.actionButtonText}>
                  Pulse ({player.vitals_charge_seconds ?? 0}s)
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionButton, styles.killButton]}
              onPress={handleIWasKilledTap}
            >
              <Text style={styles.actionButtonText}>I Was Eliminated</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <Modal visible={pendingTaskIndex !== null} transparent animationType="fade">
        <View style={styles.vitalsOverlay}>
          <View style={styles.vitalsModal}>
            <Text style={styles.vitalsTitle}>Complete Assignment?</Text>
            <Text style={styles.vitalsTimer}>
              {pendingTaskIndex !== null ? player.tasks[pendingTaskIndex]?.name : ''}
            </Text>
            <Text style={{ color: '#aaaaaa', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>
              This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={[styles.vitalsCloseButton, { flex: 1, backgroundColor: '#333' }]}
                onPress={() => setPendingTaskIndex(null)}
              >
                <Text style={styles.vitalsCloseText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.vitalsCloseButton, { flex: 1, backgroundColor: '#2ecc71' }]}
                onPress={confirmTask}
              >
                <Text style={styles.vitalsCloseText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={vitalsOpen} transparent animationType="fade">
        <View style={styles.vitalsOverlay}>
          <View style={styles.vitalsModal}>
            <Text style={styles.vitalsTitle}>Pulse</Text>
            <Text style={styles.vitalsTimer}>{vitalsSecondsLeft}s remaining</Text>
            <ScrollView style={styles.vitalsList}>
              {allPlayers
                .filter((p) => p.id !== playerId)
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((p) => (
                  <View key={p.id} style={styles.vitalsRow}>
                    <View style={[styles.vitalsStatusDot, { backgroundColor: p.is_alive ? '#2ecc71' : '#e74c3c' }]} />
                    <Text style={styles.vitalsName}>{p.display_name}</Text>
                    <Text style={[styles.vitalsStatus, { color: p.is_alive ? '#2ecc71' : '#e74c3c' }]}>
                      {p.is_alive ? 'Alive' : 'Dead'}
                    </Text>
                  </View>
                ))}
            </ScrollView>
            <TouchableOpacity style={styles.vitalsCloseButton} onPress={closeVitals}>
              <Text style={styles.vitalsCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  nameBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  nameBadgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  nameBadge: {
    color: '#888',
    fontSize: 12,
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
  vitalsButton: {
    borderColor: '#2ecc71',
    backgroundColor: '#0d2b1a',
  },
  vitalsButtonDisabled: {
    borderColor: '#555',
    backgroundColor: '#1e1e2e',
    opacity: 0.7,
  },
  vitalsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  vitalsModal: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: '#2ecc71',
  },
  vitalsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2ecc71',
    textAlign: 'center',
    marginBottom: 4,
  },
  vitalsTimer: {
    color: '#aaaaaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  vitalsList: {
    maxHeight: 300,
  },
  vitalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    gap: 10,
  },
  vitalsStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  vitalsName: {
    color: '#ffffff',
    fontSize: 16,
    flex: 1,
  },
  vitalsStatus: {
    fontSize: 14,
    fontWeight: '600',
  },
  vitalsCloseButton: {
    marginTop: 16,
    backgroundColor: '#0f3460',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  vitalsCloseText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});