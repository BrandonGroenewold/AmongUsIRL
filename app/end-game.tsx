import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useHostFailover } from '../hooks/useHostFailover';
import { clearSession } from '../lib/session';
import { supabase } from '../lib/supabase';

type Task = {
  name: string;
  done: boolean;
};

type Player = {
  id: string;
  display_name: string;
  color: string;
  role: string;
  is_alive: boolean;
  is_host: boolean;
  tasks: Task[];
  last_seen: string;
  created_at: string;
};

type Room = {
  id: string;
  status: string;
  winner: string | null;
};

type DeathCause =
  | { type: 'killed'; byName: string }
  | { type: 'ejected' }
  | null;

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c', Blue: '#3498db', Green: '#2ecc71',
    Purple: '#9b59b6', Yellow: '#f1c40f', Orange: '#e67e22',
    Pink: '#fd79a8', Cyan: '#00cec9', White: '#dfe6e9', Brown: '#a0522d',
  };
  return map[colorName] ?? '#888';
}

function getRoleLabel(role: string): string {
  if (role === 'impostor') return 'The Mole';
  if (role === 'jester') return 'Loose Cannon';
  if (role === 'scientist') return 'Hacker';
  return 'Operative';
}

function getRoleColor(role: string): string {
  if (role === 'impostor') return '#E5383B';
  if (role === 'jester') return '#FFD60A';
  if (role === 'scientist') return '#22D3C8';
  return '#2CB67D';
}

type WinnerConfig = {
  label: string;
  color: string;
};

function getWinnerConfig(winner: string | null): WinnerConfig {
  if (winner === 'impostor') return { label: 'The Moles Win', color: '#E5383B' };
  if (winner === 'jester') return { label: 'Loose Cannon Wins', color: '#FFD60A' };
  if (winner === 'crewmate') return { label: 'Operatives Win', color: '#2CB67D' };
  return { label: 'Game Over', color: '#F0B429' };
}

export default function EndGameScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [deathCauses, setDeathCauses] = useState<Record<string, DeathCause>>({});
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [reportWindowExpired, setReportWindowExpired] = useState(false);

  const playersRef = useRef<Player[]>([]);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 20000);

  const currentPlayer = players.find((p) => p.id === playerId);
  const isHost = currentPlayer?.is_host ?? false;

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setResetting(false);
      setReportWindowExpired(false);
      fetchEndGameData();

      const channel = supabase
        .channel(`end-game-room:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
          (payload) => {
            if (payload.new && (payload.new as Room).status === 'lobby') {
              router.replace(`/lobby?roomId=${roomId}&playerId=${playerId}`);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
          () => fetchPlayersOnly()
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'kills', filter: `room_id=eq.${roomId}` },
          (payload) => {
            const kill = payload.new as { killer_id: string; victim_id: string };
            const killer = playersRef.current.find((p) => p.id === kill.killer_id);
            setDeathCauses((prev) => ({
              ...prev,
              [kill.victim_id]: { type: 'killed', byName: killer?.display_name ?? 'Unknown' },
            }));
          }
        )
        .subscribe();

      const reportWindowTimer = setTimeout(() => setReportWindowExpired(true), 17000);

      return () => {
        supabase.removeChannel(channel);
        clearTimeout(reportWindowTimer);
      };
    }, [roomId, playerId])
  );

  const fetchEndGameData = async () => {
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

    const { data: killsData } = await supabase
      .from('kills')
      .select('killer_id, victim_id')
      .eq('room_id', roomId);

    const { data: meetingsData } = await supabase
      .from('meetings')
      .select('ejected_player_id')
      .eq('room_id', roomId)
      .not('ejected_player_id', 'is', null);

    if (roomData) setRoom(roomData);

    const playersList = playersData ?? [];
    if (playersData) setPlayers(playersData);

    const causes: Record<string, DeathCause> = {};

    (killsData ?? []).forEach((k) => {
      const killer = playersList.find((p) => p.id === k.killer_id);
      causes[k.victim_id] = { type: 'killed', byName: killer?.display_name ?? 'Unknown' };
    });

    (meetingsData ?? []).forEach((m) => {
      if (m.ejected_player_id) {
        causes[m.ejected_player_id] = { type: 'ejected' };
      }
    });

    setDeathCauses(causes);
    setLoading(false);
  };

  const fetchPlayersOnly = async () => {
    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (playersData) setPlayers(playersData);
  };

  const handlePlayAgain = async () => {
    setResetting(true);

    const { data: oldMeetings } = await supabase
      .from('meetings')
      .select('id')
      .eq('room_id', roomId);

    const oldMeetingIds = (oldMeetings ?? []).map((m) => m.id);
    if (oldMeetingIds.length > 0) {
      await supabase.from('votes').delete().in('meeting_id', oldMeetingIds);
    }
    await supabase.from('meetings').delete().eq('room_id', roomId);
    await supabase.from('kills').delete().eq('room_id', roomId);

    await supabase
      .from('players')
      .update({
        role: null,
        tasks: [],
        is_alive: true,
        ready_for_meeting: false,
        last_kill_at: null,
        vitals_charge_seconds: 0,
      })
      .eq('room_id', roomId);

    await supabase
      .from('rooms')
      .update({ status: 'lobby', winner: null })
      .eq('id', roomId);
  };

  const handleLeave = async () => {
    if (isHost) {
      const nextHost = players
        .filter((p) => p.id !== playerId)
        .sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )[0];

      if (nextHost) {
        await supabase.from('players').update({ is_host: true }).eq('id', nextHost.id);
        await supabase.from('rooms').update({ host_id: nextHost.id }).eq('id', roomId);
      }
    }

    const { error: deleteError } = await supabase
      .from('players')
      .delete()
      .eq('id', playerId);
    if (deleteError) console.error('Failed to delete player row on leave:', deleteError);

    await clearSession();
    router.replace('/');
  };

  if (loading || !room) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  const winner = getWinnerConfig(room.winner);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Winner banner */}
      <View style={[styles.winnerBanner, { borderColor: winner.color }]}>
        <Text style={styles.winnerEyebrow}>MISSION COMPLETE</Text>
        <Text style={[styles.winnerHeadline, { color: winner.color }]}>
          {winner.label}
        </Text>
      </View>

      {/* Section header */}
      <Text style={styles.sectionLabel}>FINAL DOSSIER</Text>

      {/* Player cards */}
      <View style={styles.playerList}>
        {players.map((p, index) => {
          const cause = deathCauses[p.id];
          const completedCount = p.tasks.filter((t) => t.done).length;
          const isFakeTasks = p.role === 'impostor' || p.role === 'jester';
          const roleColor = getRoleColor(p.role);

          const impostorLost = p.role === 'impostor' && room.winner !== 'impostor';
          const jesterLost = p.role === 'jester' && room.winner !== 'jester';
          const survivedButLost = impostorLost || jesterLost;

          let statusText = '';
          let statusColor = '';

          if (p.is_alive) {
            if (survivedButLost) {
              statusText = 'Failed';
              statusColor = '#E5383B';
            } else {
              statusText = 'Survived';
              statusColor = '#2CB67D';
            }
          } else {
            statusColor = '#5A5A7A';
            if (cause?.type === 'killed') {
              statusText = `Burned by ${cause.byName}`;
            } else if (cause?.type === 'ejected') {
              statusText = 'Voted out';
            } else if (reportWindowExpired) {
              statusText = 'Eliminated';
            } else {
              statusText = 'Report pending…';
            }
          }

          return (
            <View
              key={p.id}
              style={[
                styles.playerCard,
                index < players.length - 1 && styles.playerCardBorder,
              ]}
            >
              {/* Left: color dot + name */}
              <View style={styles.playerLeft}>
                <View
                  style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]}
                />
                <View style={styles.playerMeta}>
                  <Text style={styles.playerName}>{p.display_name}</Text>
                  <Text style={styles.playerStatus} numberOfLines={1}>
                    <Text style={{ color: statusColor }}>{statusText}</Text>
                    {'  ·  '}
                    <Text style={styles.taskCount}>
                      {isFakeTasks ? 'Fake' : ''} {completedCount}/{p.tasks.length} assignments
                    </Text>
                  </Text>
                </View>
              </View>

              {/* Right: role badge */}
              <View style={[styles.roleBadge, { borderColor: roleColor }]}>
                <Text style={[styles.roleBadgeText, { color: roleColor }]}>
                  {getRoleLabel(p.role)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {isHost ? (
          <TouchableOpacity
            style={[styles.primaryButton, resetting && styles.buttonDisabled]}
            onPress={handlePlayAgain}
            disabled={resetting}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>
              {resetting ? 'Resetting…' : 'Play Again'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.waitingCard}>
            <Text style={styles.waitingText}>Waiting for host to start a new game…</Text>
          </View>
        )}

        <TouchableOpacity onPress={handleLeave} activeOpacity={0.6} style={styles.leaveButton}>
          <Text style={styles.leaveText}>Leave Game</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#09091A',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 48,
  },

  // Winner banner
  winnerBanner: {
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: '#16162A',
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 36,
  },
  winnerEyebrow: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 3,
    color: '#5A5A7A',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  winnerHeadline: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 40,
    letterSpacing: 1,
    textAlign: 'center',
  },

  // Section label
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 3,
    color: '#5A5A7A',
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  // Player list
  playerList: {
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    marginBottom: 32,
    overflow: 'hidden',
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  playerCardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  playerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    flexShrink: 0,
  },
  playerMeta: {
    flex: 1,
    minWidth: 0,
  },
  playerName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: '#F0F0FA',
    marginBottom: 2,
  },
  playerStatus: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: '#5A5A7A',
  },
  taskCount: {
    color: '#3A3A5A',
  },

  // Role badge
  roleBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  roleBadgeText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Actions
  actions: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  primaryButtonText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 17,
    color: '#09091A',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  waitingCard: {
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingVertical: 18,
    alignItems: 'center',
  },
  waitingText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
    textAlign: 'center',
  },
  leaveButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  leaveText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#3A3A5A',
  },
});