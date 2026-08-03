import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import HowToPlayModal from '../components/HowToPlayModal';
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
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 20000);

  const isHost = room?.host_id === playerId;

  useFocusEffect(
    useCallback(() => {
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
    const { data: roomData } = await supabase.from('rooms').select('*').eq('id', roomId).single();
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: playersData } = await supabase
  .from('players')
  .select('*')
  .eq('room_id', roomId)
  .gte('last_seen', cutoff)
  .order('created_at', { ascending: true });

    if (roomData) setRoom(roomData);
    if (playersData) {
      setPlayers(playersData);
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
    await supabase.from('players').delete().eq('id', playerId);
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
    await supabase.from('rooms').update({ settings: newSettings }).eq('id', roomId);
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
      if (index < impostorCount) roles[player.id] = 'impostor';
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
      const assignedTasks =
        role === 'impostor'
          ? shuffleTasks(taskPool).slice(0, taskCount).map((t: any) => ({ ...t, done: false, fake: true }))
          : shuffleTasks(taskPool).slice(0, taskCount).map((t: any) => ({ ...t, done: false, fake: false }));
      return supabase.from('players').update({ role, tasks: assignedTasks }).eq('id', player.id);
    });

    await Promise.all(updates);
    await supabase.from('rooms').update({ status: 'in_progress' }).eq('id', roomId);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Lobby</Text>

      {/* Room Code */}
      <View style={styles.codeCard}>
        <Text style={styles.sectionLabel}>ROOM CODE</Text>
        <Text style={styles.code}>{room?.code}</Text>
        <Text style={styles.codeHint}>Share this with your crew</Text>
      </View>

      {/* Players */}
      <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>
        PLAYERS ({players.length})
      </Text>
      <View style={styles.card}>
        {players.map((player, index) => {
          const disconnected = isDisconnected(player.last_seen);
          const isLast = index === players.length - 1;
          return (
            <View key={player.id} style={[styles.playerRow, isLast && styles.rowNoBorder]}>
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: getColorHex(player.color) },
                  disconnected && styles.colorDotDisconnected,
                ]}
              />
              <Text style={[styles.playerName, disconnected && styles.playerNameDisconnected]}>
                {player.display_name}
              </Text>
              <View style={styles.playerBadges}>
                {disconnected && <Text style={styles.disconnectedBadge}>OFFLINE</Text>}
                {player.is_host && (
                  <View style={styles.hostBadge}>
                    <Text style={styles.hostBadgeText}>HOST</Text>
                  </View>
                )}
                {isHost && !player.is_host && !disconnected && (
                  <TouchableOpacity
                    onPress={() => handlePromoteHost(player.id)}
                    style={styles.promoteButton}
                  >
                    <Text style={styles.promoteText}>↑ Promote</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Settings */}
      <TouchableOpacity
        onPress={() => isHost && setShowSettings(true)}
        disabled={!isHost}
        activeOpacity={isHost ? 0.7 : 1}
      >
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>GAME SETTINGS</Text>
          {isHost && <Text style={styles.editHint}>✎ EDIT</Text>}
        </View>
      </TouchableOpacity>
      <View style={styles.card}>
        <SettingRow label="Moles" value={room?.settings.impostor_count ?? 1} />
        <SettingRow label="Assignments per player" value={room?.settings.task_count ?? 3} />
        <SettingRow label="Burn cooldown" value={`${room?.settings.kill_cooldown ?? 30}s`} />
        <SettingRow label="Gathering time" value={`${room?.settings.gathering_time ?? 45}s`} />
        <SettingRow label="Debrief time" value={`${room?.settings.discussion_time ?? 60}s`} />
        <SettingRow label="Voting time" value={`${room?.settings.voting_time ?? 60}s`} />
        <SettingRow label="Emergency debriefs" value={room?.settings.emergency_meetings ?? 1} />
        <SettingRow
          label="Role reveal on burn"
          value={room?.settings.role_reveal ? 'On' : 'Off'}
        />
        <SettingRow
          label="Task visibility"
          value={room?.settings.task_visibility ?? 'Meetings'}
          last
        />
      </View>

      {/* Host-only actions */}
      {isHost && (
        <TouchableOpacity
          onPress={() => setShowManagePlayers(true)}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>MANAGE PLAYERS</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => setShowHowToPlay(true)} style={styles.ghostButton}>
        <Text style={styles.ghostText}>How to Play</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleLeave} style={styles.ghostButton}>
        <Text style={styles.leaveText}>Leave Lobby</Text>
      </TouchableOpacity>

      {/* Start / Waiting */}
      {isHost ? (
        <TouchableOpacity style={styles.startButton} onPress={handleStartGame}>
          <Text style={styles.startButtonText}>START GAME</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.waitingContainer}>
          <ActivityIndicator size="small" color="#5A5A7A" style={{ marginBottom: 8 }} />
          <Text style={styles.waitingText}>Waiting for host to start...</Text>
        </View>
      )}

      {/* Modals */}
      <HowToPlayModal visible={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
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
              {players
                .filter((p) => p.id !== playerId)
                .map((p, index, arr) => (
                  <View
                    key={p.id}
                    style={[styles.modalRow, index === arr.length - 1 && styles.rowNoBorder]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]} />
                    <Text style={styles.modalPlayerName}>{p.display_name}</Text>
                    <TouchableOpacity
                      onPress={() => handleKickPlayer(p.id)}
                      style={styles.kickButton}
                    >
                      <Text style={styles.kickButtonText}>Kick</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleBanPlayer(p.id, p.device_id)}
                      style={styles.banButton}
                    >
                      <Text style={styles.banButtonText}>Ban</Text>
                    </TouchableOpacity>
                  </View>
                ))}
            </ScrollView>
            <TouchableOpacity
              onPress={() => setShowManagePlayers(false)}
              style={styles.ghostButton}
            >
              <Text style={styles.ghostText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SettingRow({ label, value, last = false }: { label: string; value: any; last?: boolean }) {
  return (
    <View style={[styles.settingRow, last && styles.rowNoBorder]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.settingValue}>{String(value)}</Text>
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
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#09091A',
    padding: 24,
    paddingTop: 56,
  },

  // Header
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 36,
    color: '#F0F0FA',
    textAlign: 'center',
    marginBottom: 28,
  },

  // Room Code
  codeCard: {
    backgroundColor: '#16162A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 28,
  },
  code: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 46,
    color: '#F0B429',
    letterSpacing: 10,
    marginVertical: 8,
  },
  codeHint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#3A3A5A',
  },

  // Shared card
  card: {
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  rowNoBorder: {
    borderBottomWidth: 0,
  },

  // Section labels
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  editHint: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#F0B429',
    letterSpacing: 2,
  },

  // Player rows
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: 14,
  },
  colorDotDisconnected: {
    opacity: 0.25,
  },
  playerName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: '#F0F0FA',
    flex: 1,
  },
  playerNameDisconnected: {
    color: '#3A3A5A',
  },
  playerBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostBadge: {
    backgroundColor: 'rgba(240,180,41,0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#F0B429',
  },
  hostBadgeText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#F0B429',
    letterSpacing: 1,
  },
  disconnectedBadge: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#3A3A5A',
    letterSpacing: 1,
  },
  promoteButton: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#22223A',
  },
  promoteText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: '#5A5A7A',
  },

  // Setting rows
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  settingLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
  },
  settingValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: '#F0F0FA',
  },

  // Buttons
  startButton: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  startButtonText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 17,
    letterSpacing: 2,
  },
  secondaryButton: {
    borderWidth: 2,
    borderColor: '#F0B429',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryButtonText: {
    fontFamily: 'Nunito_900Black',
    color: '#F0B429',
    fontSize: 15,
    letterSpacing: 2,
  },
  ghostButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  ghostText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#4A4A6A',
  },
  leaveText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#4A4A6A',
    marginBottom: 8,
  },
  waitingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  waitingText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
  },

  // Manage Players modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#1E1E30',
    borderRadius: 20,
    padding: 24,
    width: '88%',
    maxHeight: '72%',
    borderWidth: 1,
    borderColor: '#22223A',
  },
  modalTitle: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 22,
    color: '#F0F0FA',
    textAlign: 'center',
    marginBottom: 20,
  },
  modalList: {
    marginBottom: 8,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  modalPlayerName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
    flex: 1,
    marginLeft: 12,
  },
  kickButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5383B',
    marginRight: 6,
  },
  kickButtonText: {
    fontFamily: 'Nunito_700Bold',
    color: '#E5383B',
    fontSize: 12,
    letterSpacing: 1,
  },
  banButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3A3A5A',
  },
  banButtonText: {
    fontFamily: 'Nunito_700Bold',
    color: '#5A5A7A',
    fontSize: 12,
    letterSpacing: 1,
  },
});