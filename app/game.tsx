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

function GlobalTaskBar({
  players,
  visibility,
  isMeeting,
}: {
  players: Player[];
  visibility?: string;
  isMeeting: boolean;
}) {
  const crewPlayers = players.filter((p) => p.role !== 'impostor' && p.role !== 'jester');
  const totalTasks = crewPlayers.reduce((sum, p) => sum + p.tasks.length, 0);
  const completedTasks = crewPlayers.reduce(
    (sum, p) => sum + p.tasks.filter((t) => t.done).length,
    0
  );
  const percent = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const shouldShow = visibility === 'Always' || (visibility === 'Meetings' && isMeeting);
  if (!shouldShow) return null;

  return (
    <View style={styles.taskBarContainer}>
      <View style={styles.taskBarMeta}>
        <Text style={styles.taskBarLabel}>MISSION PROGRESS</Text>
        <Text style={styles.taskBarPercent}>{Math.round(percent * 100)}%</Text>
      </View>
      <View style={styles.taskBarTrack}>
        <View style={[styles.taskBarFill, { width: `${percent * 100}%` as any }]} />
      </View>
    </View>
  );
}

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c',
    Blue: '#3498db',
    Green: '#2ecc71',
    Purple: '#9b59b6',
    Yellow: '#f1c40f',
    Orange: '#e67e22',
    Pink: '#fd79a8',
    Cyan: '#00cec9',
    White: '#dfe6e9',
    Brown: '#a0522d',
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
  const [displayVitalsCharge, setDisplayVitalsCharge] = useState(0);
  const [pendingTaskIndex, setPendingTaskIndex] = useState<number | null>(null);
  const vitalsOpenedWithRef = useRef(0);
  const vitalsRemainingRef = useRef(0);

  const playerRef = useRef<Player | null>(null);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  const needsKillerSelectionRef = useRef(false);
  useEffect(() => {
    needsKillerSelectionRef.current = needsKillerSelection;
  }, [needsKillerSelection]);

  const killerSelectedRef = useRef(false);
  useEffect(() => {
    killerSelectedRef.current = killerSelected;
  }, [killerSelected]);

  useEffect(() => {
  setDisplayVitalsCharge(player?.vitals_charge_seconds ?? 0);
  }, [player?.vitals_charge_seconds]);

  const finalReportTimerStarted = useRef(false);
  const [finalReportSecondsLeft, setFinalReportSecondsLeft] = useState(15);

  useHeartbeat(playerId);
  useHostFailover(roomId, allPlayers, playerId, 120000, true);

  useFocusEffect(
    useCallback(() => {
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
                const iStillNeedToReport =
                  needsKillerSelectionRef.current && !killerSelectedRef.current;
                if (!iStillNeedToReport) {
                  router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
                }
              }
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(playerChannel);
        supabase.removeChannel(roomChannel);
      };
    }, [roomId, playerId])
  );

  useEffect(() => {
    const interval = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!vitalsOpen) return;
    const interval = setInterval(() => {
      vitalsRemainingRef.current -= 1;
      setVitalsSecondsLeft(vitalsRemainingRef.current);
      if (vitalsRemainingRef.current <= 0) {
      clearInterval(interval);
      setVitalsOpen(false);
      setDisplayVitalsCharge(0); // immediate — don't wait for subscription
      supabase.from('players').update({ vitals_charge_seconds: 0 }).eq('id', playerId);
    }
    }, 1000);
    return () => clearInterval(interval);
  }, [vitalsOpen]);

  useEffect(() => {
    const shouldCountDown =
      room?.status === 'ended' && needsKillerSelection && !killerSelected;

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
      if (!data.is_alive) checkIfKillerAlreadySelected();
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
      if (roomData.status === 'meeting') {
        router.replace(`/gathering?roomId=${roomId}&playerId=${playerId}`);
        return;
      }
      if (roomData.status === 'ended') {
        const iStillNeedToReport =
          needsKillerSelectionRef.current && !killerSelectedRef.current;
        if (!iStillNeedToReport) {
          router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
          return;
        }
      }
    }
    if (playersData) {
      setAllPlayers(playersData);
      checkTaskWinCondition(roomData, playersData);
      checkEliminationWinCondition(playersData, roomData);
    }
  };

  const checkIfKillerAlreadySelected = async () => {
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

  const checkEliminationWinCondition = async (playersList: Player[], currentRoom: Room | null) => {
  if (!currentRoom || currentRoom.status === 'ended') return;

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
      await supabase.from('rooms').update({ status: 'ended', winner }).eq('id', roomId);
    }
  };

  const toggleTask = (index: number) => {
    if (!player) return;
    if (player.tasks[index].done) return;
    setPendingTaskIndex(index);
  };

  const confirmTask = async () => {
    if (pendingTaskIndex === null || !player) return;
    const index = pendingTaskIndex;
    setPendingTaskIndex(null);

    const updatedTasks = [...player.tasks];
    updatedTasks[index] = { ...updatedTasks[index], done: true };

    const updates: any = { tasks: updatedTasks };

    if (player.role === 'scientist' && !player.tasks[index].fake) {
      const secondsPerTask = room?.settings?.vitals_seconds_per_task ?? 10;
      const currentCharge = player.vitals_charge_seconds ?? 0;
      updates.vitals_charge_seconds = currentCharge + secondsPerTask;
    }

    await supabase.from('players').update(updates).eq('id', playerId);
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

    await supabase.from('rooms').update({ status: 'meeting' }).eq('id', roomId);
  };

  const getKillCooldownRemaining = () => {
    if (!player?.last_kill_at) return 0;
    const killCooldownSeconds = room?.settings?.kill_cooldown ?? 30;
    const lastKill = new Date(player.last_kill_at).getTime();
    const cooldownMs = killCooldownSeconds * 1000;
    const elapsed = Date.now() - lastKill;
    const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
    return remaining > 0 ? remaining : 0;
  };

  const openVitals = () => {
    const currentCharge = displayVitalsCharge;
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
    const minCost = room?.settings?.vitals_min_open_cost ?? 3;
    const consumed = openedWith - remaining;
    const actualRemaining =
      consumed >= minCost ? remaining : Math.max(0, openedWith - minCost);
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

  const handleIWasKilledTap = () => setConfirmingDeath(true);
  const cancelDeath = () => setConfirmingDeath(false);

  const confirmDeath = async () => {
    setConfirmingDeath(false);
    await supabase.from('players').update({ is_alive: false }).eq('id', playerId);
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

    if (room?.status === 'ended') {
      router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
    }
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading || !player) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  // ─── Dead: killer selection ──────────────────────────────────────────────────
  if (!player.is_alive) {
    if (needsKillerSelection && !killerSelected) {
      const isFinalReport = room?.status === 'ended';
      const livingOthers = allPlayers.filter(
        (p) => p.is_alive && p.id !== playerId && p.role === 'impostor'
      );
      return (
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.killerHeading}>Who Burned You?</Text>

          {isFinalReport ? (
            <View style={styles.countdownBadge}>
              <Text style={styles.countdownNumber}>{finalReportSecondsLeft}</Text>
              <Text style={styles.countdownLabel}>SECONDS TO REPORT</Text>
            </View>
          ) : (
            <Text style={styles.privateNote}>
              Private — only used for the end-game summary.
            </Text>
          )}

          <View style={styles.killerList}>
            {livingOthers.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.killerCard}
                onPress={() => selectKiller(p.id)}
              >
                <View style={[styles.killerDot, { backgroundColor: getColorHex(p.color) }]} />
                <Text style={styles.killerName}>{p.display_name}</Text>
                <Text style={styles.killerChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      );
    }

    // ─── Dead: spectator ──────────────────────────────────────────────────────
    return (
      <View style={styles.centered}>
        <RoleRevealButton
          displayName={player.display_name}
          role={player.role}
          color={player.color}
        />
        <Text style={styles.deadTitle}>Eliminated</Text>
        <Text style={styles.deadSubtitle}>
          Spectating — you can no longer complete assignments or trigger debriefs.
        </Text>
      </View>
    );
  }

  // ─── Alive: main game screen ─────────────────────────────────────────────────
  const isImpostor = player.role === 'impostor';
  const isImpostorOrJester = player.role === 'impostor' || player.role === 'jester';
  const isScientist = player.role === 'scientist';
  const completedCount = player.tasks.filter((t) => t.done).length;
  const cooldownRemaining = getKillCooldownRemaining();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <GlobalTaskBar
        players={allPlayers}
        visibility={room?.settings?.task_visibility}
        isMeeting={false}
      />

      <RoleRevealButton
        displayName={player.display_name}
        role={player.role}
        color={player.color}
      />

      {/* Assignments -------------------------------------------------------- */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>
          {isImpostorOrJester ? 'FAKE ASSIGNMENTS' : 'YOUR ASSIGNMENTS'}
        </Text>
        <Text style={styles.progressBadge}>
          {completedCount}/{player.tasks.length}
        </Text>
      </View>

      <View style={styles.taskCard}>
        {player.tasks.map((task, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.taskRow,
              index === player.tasks.length - 1 && styles.taskRowLast,
            ]}
            onPress={() => toggleTask(index)}
          >
            <View style={[styles.checkbox, task.done && styles.checkboxDone]}>
              {task.done && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.taskName, task.done && styles.taskNameDone]}>
                {task.name}
              </Text>
              <Text style={styles.taskLocation}>📍 {task.location}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Actions ------------------------------------------------------------ */}
      <View style={styles.actionSection}>
        <Text style={styles.sectionLabel}>ACTIONS</Text>

        <TouchableOpacity
          style={[styles.btn, styles.btnReport]}
          onPress={() => handleTriggerMeeting('report')}
        >
          <Text style={[styles.btnText, styles.btnTextGold]}>Report Body</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnEmergency]}
          onPress={() => handleTriggerMeeting('emergency')}
        >
          <Text style={[styles.btnText, styles.btnTextYellow]}>Emergency Debrief</Text>
        </TouchableOpacity>

        {isImpostor ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnBurn, cooldownRemaining > 0 && styles.btnDisabled]}
            onPress={handleKillTap}
            disabled={cooldownRemaining > 0}
          >
            <Text style={[styles.btnText, cooldownRemaining > 0 ? styles.btnTextMuted : styles.btnTextRed]}>
              {cooldownRemaining > 0 ? `Burn Cooldown — ${cooldownRemaining}s` : 'Burn'}
            </Text>
          </TouchableOpacity>
        ) : confirmingDeath ? (
          <View style={styles.confirmRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnBurn, { flex: 1 }]}
              onPress={confirmDeath}
            >
              <Text style={[styles.btnText, styles.btnTextRed]}>Confirm — Burned</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnCancel, { flex: 1 }]}
              onPress={cancelDeath}
            >
              <Text style={[styles.btnText, styles.btnTextMuted]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {isScientist && (
              <TouchableOpacity
                style={[
      styles.btn,
      styles.btnPulse,
      displayVitalsCharge === 0 && styles.btnDisabled,
    ]}
    onPress={openVitals}
    disabled={displayVitalsCharge === 0}
  >
    <Text
      style={[
        styles.btnText,
        displayVitalsCharge === 0
          ? styles.btnTextMuted
          : styles.btnTextTeal,
      ]}
    >
      Pulse — {displayVitalsCharge}sec
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.btn, styles.btnEliminated]}
              onPress={handleIWasKilledTap}
            >
              <Text style={[styles.btnText, styles.btnTextRed]}>I Was Eliminated</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Task confirmation modal -------------------------------------------- */}
      <Modal visible={pendingTaskIndex !== null} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.taskModal}>
            <Text style={styles.taskModalTitle}>Complete Assignment?</Text>
            <Text style={styles.taskModalName}>
              {pendingTaskIndex !== null ? player.tasks[pendingTaskIndex]?.name : ''}
            </Text>
            <Text style={styles.taskModalNote}>This cannot be undone.</Text>
            <View style={styles.taskModalButtons}>
              <TouchableOpacity
                style={[styles.taskModalBtn, styles.taskModalCancel, { flex: 1 }]}
                onPress={() => setPendingTaskIndex(null)}
              >
                <Text style={[styles.btnText, styles.btnTextMuted]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.taskModalBtn, styles.taskModalConfirm, { flex: 1 }]}
                onPress={confirmTask}
              >
                <Text style={[styles.btnText, { color: '#09091A' }]}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pulse modal -------------------------------------------------------- */}
      <Modal visible={vitalsOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.pulseModal}>
            <Text style={styles.pulseTitle}>Pulse</Text>
            <Text style={styles.pulseTimer}>{vitalsSecondsLeft}s remaining</Text>
            <ScrollView style={styles.pulseList}>
              {allPlayers
                .filter((p) => p.id !== playerId)
                .sort((a, b) => a.display_name.localeCompare(b.display_name))
                .map((p) => (
                  <View key={p.id} style={styles.pulseRow}>
                    <View
                      style={[
                        styles.pulseDot,
                        { backgroundColor: p.is_alive ? '#2CB67D' : '#E5383B' },
                      ]}
                    />
                    <Text style={styles.pulseName}>{p.display_name}</Text>
                    <Text
                      style={[
                        styles.pulseStatus,
                        { color: p.is_alive ? '#2CB67D' : '#E5383B' },
                      ]}
                    >
                      {p.is_alive ? 'Active' : 'Flatline'}
                    </Text>
                  </View>
                ))}
            </ScrollView>
            <TouchableOpacity style={styles.pulseCloseBtn} onPress={closeVitals}>
              <Text style={[styles.btnText, styles.btnTextTeal]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Layout ────────────────────────────────────────────────────────────────
  centered: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#09091A',
    padding: 24,
    paddingBottom: 48,
  },

  // ── Task bar ───────────────────────────────────────────────────────────────
  taskBarContainer: {
    marginBottom: 20,
  },
  taskBarMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  taskBarLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#5A5A7A',
    letterSpacing: 2,
  },
  taskBarPercent: {
    fontFamily: 'Nunito_900Black',
    fontSize: 11,
    color: '#F0B429',
    letterSpacing: 1,
  },
  taskBarTrack: {
    height: 6,
    backgroundColor: '#16162A',
    borderRadius: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#22223A',
  },
  taskBarFill: {
    height: '100%',
    backgroundColor: '#F0B429',
    borderRadius: 3,
  },

  // ── Section header ─────────────────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
  },
  progressBadge: {
    fontFamily: 'Nunito_900Black',
    fontSize: 13,
    color: '#F0B429',
    letterSpacing: 1,
  },

  // ── Task list ──────────────────────────────────────────────────────────────
  taskCard: {
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
    gap: 12,
  },
  taskRowLast: {
    borderBottomWidth: 0,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#3A3A5A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    backgroundColor: '#F0B429',
    borderColor: '#F0B429',
  },
  checkmark: {
    color: '#09091A',
    fontSize: 13,
    fontFamily: 'Nunito_900Black',
  },
  taskName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
  },
  taskNameDone: {
    color: '#3A3A5A',
    textDecorationLine: 'line-through',
  },
  taskLocation: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: '#5A5A7A',
    marginTop: 2,
  },

  // ── Action section ─────────────────────────────────────────────────────────
  actionSection: {
    marginTop: 28,
    gap: 10,
  },

  // ── Buttons ────────────────────────────────────────────────────────────────
  btn: {
  paddingVertical: 18,
  borderRadius: 16,
  alignItems: 'stretch',
  justifyContent: 'center',
  borderWidth: 2,
  },
  btnText: {
  fontFamily: 'Nunito_900Black',
  fontSize: 15,
  letterSpacing: 2,
  textTransform: 'uppercase',
  textAlign: 'center',
  },
  btnReport: {
    borderColor: '#F0B429',
    backgroundColor: 'transparent',
  },
  btnEmergency: {
    borderColor: '#FFD60A',
    backgroundColor: 'transparent',
  },
  btnBurn: {
    borderColor: '#E5383B',
    backgroundColor: '#1A0808',
  },
  btnEliminated: {
    borderColor: '#E5383B',
    backgroundColor: 'transparent',
  },
  btnPulse: {
    borderColor: '#22D3C8',
    backgroundColor: 'transparent',
  },
  btnCancel: {
    borderColor: '#22223A',
    backgroundColor: '#16162A',
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnTextGold: { color: '#F0B429' },
  btnTextYellow: { color: '#FFD60A' },
  btnTextRed: { color: '#E5383B' },
  btnTextTeal: { color: '#22D3C8' },
  btnTextMuted: { color: '#5A5A7A' },

  confirmRow: {
    flexDirection: 'row',
    gap: 10,
  },

  // ── Killer selection ───────────────────────────────────────────────────────
  killerHeading: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 30,
    color: '#E5383B',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  countdownBadge: {
    backgroundColor: '#16162A',
    borderWidth: 1,
    borderColor: '#F0B429',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  countdownNumber: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 52,
    color: '#F0B429',
    lineHeight: 56,
  },
  countdownLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#5A5A7A',
    letterSpacing: 2,
    marginTop: 4,
  },
  privateNote: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
    textAlign: 'center',
    marginBottom: 24,
  },
  killerList: {
    gap: 10,
  },
  killerCard: {
    backgroundColor: '#16162A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  killerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  killerName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: '#F0F0FA',
    flex: 1,
  },
  killerChevron: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 22,
    color: '#5A5A7A',
  },

  // ── Dead / spectator ───────────────────────────────────────────────────────
  deadTitle: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 32,
    color: '#E5383B',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  deadSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },

  // ── Modals ─────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  // Task confirmation modal
  taskModal: {
    backgroundColor: '#1E1E30',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#22223A',
  },
  taskModalTitle: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 22,
    color: '#F0B429',
    textAlign: 'center',
    marginBottom: 10,
  },
  taskModalName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: '#F0F0FA',
    textAlign: 'center',
    marginBottom: 6,
  },
  taskModalNote: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#5A5A7A',
    textAlign: 'center',
    marginBottom: 24,
  },
  taskModalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  taskModalBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  taskModalCancel: {
    borderColor: '#22223A',
    backgroundColor: '#16162A',
  },
  taskModalConfirm: {
    borderColor: '#2CB67D',
    backgroundColor: '#2CB67D',
  },

  // Pulse modal
  pulseModal: {
    backgroundColor: '#1E1E30',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxHeight: '72%',
    borderWidth: 1,
    borderColor: '#22D3C8',
  },
  pulseTitle: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 22,
    color: '#22D3C8',
    textAlign: 'center',
    marginBottom: 4,
  },
  pulseTimer: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#5A5A7A',
    textAlign: 'center',
    marginBottom: 16,
  },
  pulseList: {
    maxHeight: 300,
  },
  pulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
    gap: 10,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pulseName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
    flex: 1,
  },
  pulseStatus: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    letterSpacing: 1,
  },
  pulseCloseBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#22D3C8',
    backgroundColor: 'transparent',
  },
});