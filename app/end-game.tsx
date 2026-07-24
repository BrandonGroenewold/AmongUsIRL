import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  if (role === 'impostor') return 'Impostor';
  if (role === 'jester') return 'Jester';
  if (role === 'scientist') return 'Scientist';
  return 'Crewmate';
}

function getWinnerLabel(winner: string | null): string {
  if (winner === 'impostor') return 'Impostors Win';
  if (winner === 'jester') return 'Jester Wins';
  if (winner === 'crewmate') return 'Crewmates Win';
  return 'Game Over';
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
  useHostFailover(roomId, players, playerId, 20000); // 20s — no timer pressure here, but no reason to leave the room host-less for long either

  const currentPlayer = players.find((p) => p.id === playerId);
  const isHost = currentPlayer?.is_host ?? false;

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      setResetting(false);
      setReportWindowExpired(false);
      fetchEndGameData();

      // Listen for the host resetting the room — everyone routes back to lobby together —
      // and for a late-arriving kill report, since the last victim can still be mid-countdown
      // on game.tsx's "who killed you" screen when the rest of us already landed here
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

      // Give the last victim's 15s report window (plus a little network buffer) to come in
      // before giving up and just showing "Eliminated" for anyone still unresolved
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

    // Build a cause-of-death map so every dead player shows a real reason, not just "dead"
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

  // Lighter-weight than fetchEndGameData — just refreshes the player list (host changes,
  // someone leaving) without redoing the kills/meetings death-cause lookup every time
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

    // Clean up last game's meetings/votes/kills so they don't bleed into the next game's
    // end-screen or task/kill logic, since everything is still keyed off the same room_id
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

    // Reset every player back to a clean lobby state, keeping their identity/color/host status
    await supabase
      .from('players')
      .update({
        role: null,
        tasks: [],
        is_alive: true,
        ready_for_meeting: false,
        last_kill_at: null,
      })
      .eq('room_id', roomId);

await supabase
      .from('rooms')
      .update({ status: 'lobby', winner: null })
      .eq('id', roomId);

    // The realtime subscription above will route everyone (including this device) to lobby
  };

  const handleLeave = async () => {
    if (isHost) {
      const nextHost = players
        .filter((p) => p.id !== playerId)
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

  if (loading || !room) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.winnerBanner}>{getWinnerLabel(room.winner)}</Text>

      <Text style={styles.sectionLabel}>Final Roles</Text>
      <View style={styles.playerList}>
        {players.map((p) => {
          const cause = deathCauses[p.id];
          const completedCount = p.tasks.filter((t) => t.done).length;
          const isFakeTasks = p.role === 'impostor' || p.role === 'jester';

          return (
            <View key={p.id} style={styles.playerRow}>
              <View style={styles.playerRowTop}>
                <View style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]} />
                <Text style={styles.playerName}>{p.display_name}</Text>
                <Text style={styles.roleLabel}>{getRoleLabel(p.role)}</Text>
              </View>

               <View style={styles.playerRowBottom}>
                {(() => {
                   // Being alive isn't the same as winning. An impostor who was never caught
                  // but whose team still lost shouldn't read as green "Survived" — and a
                  // Jester's entire win condition is getting voted out, so a Jester who's
                  // still alive at game end always lost too, regardless of who else won
                  const impostorLost = p.role === 'impostor' && room.winner !== 'impostor';
                  const jesterLost = p.role === 'jester' && room.winner !== 'jester';
                  const survivedButLost = impostorLost || jesterLost;

                  if (p.is_alive) {
                    return (
                      <Text style={survivedButLost ? styles.failedText : styles.aliveText}>
                        {survivedButLost ? 'Failed' : 'Survived'}
                      </Text>
                    );
                  }

                  return (
                    <Text style={styles.deadText}>
                      {cause?.type === 'killed'
                        ? `Killed by ${cause.byName}`
                        : cause?.type === 'ejected'
                          ? 'Voted out'
                          : reportWindowExpired
                            ? 'Eliminated'
                            : 'Final report pending...'}
                    </Text>
                  );
                })()}
                <Text style={styles.taskText}>
                  {isFakeTasks ? 'Fake tasks' : 'Tasks'}: {completedCount}/{p.tasks.length}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {isHost ? (
        <TouchableOpacity
          style={[styles.playAgainButton, resetting && styles.playAgainButtonDisabled]}
          onPress={handlePlayAgain}
          disabled={resetting}
        >
          <Text style={styles.playAgainButtonText}>
            {resetting ? 'Resetting...' : 'Play Again'}
          </Text>
        </TouchableOpacity>
) : (
        <Text style={styles.waitingText}>Waiting for host to start a new game...</Text>
      )}

      <TouchableOpacity onPress={handleLeave} style={styles.leaveButton}>
        <Text style={styles.leaveText}>Leave</Text>
      </TouchableOpacity>
    </ScrollView>
  );
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
  winnerBanner: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 28,
  },
  sectionLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  playerList: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 28,
  },
  playerRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  playerRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  playerRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: 26,
  },
  colorDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  playerName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  roleLabel: {
    color: '#e74c3c',
    fontSize: 13,
    fontWeight: 'bold',
  },
  aliveText: {
    color: '#2ecc71',
    fontSize: 13,
  },
  failedText: {
    color: '#e74c3c',
    fontSize: 13,
    fontWeight: '600',
  },
  deadText: {
    color: '#888',
    fontSize: 13,
  },
  taskText: {
    color: '#aaaaaa',
    fontSize: 13,
  },
  playAgainButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  playAgainButtonDisabled: {
    opacity: 0.6,
  },
  playAgainButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  waitingText: {
    color: '#aaaaaa',
    textAlign: 'center',
    fontSize: 15,
  },
  leaveButton: {
    alignItems: 'center',
    marginTop: 16,
  },
  leaveText: {
    color: '#aaaaaa',
    fontSize: 16,
  },
});