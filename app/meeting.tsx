import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useHostFailover } from '../hooks/useHostFailover';
import { supabase } from '../lib/supabase';

type Player = {
  id: string;
  display_name: string;
  color: string;
  role: string;
  is_alive: boolean;
  is_host: boolean;
  last_seen: string;
  created_at: string;
};

type Meeting = {
  id: string;
  room_id: string;
  triggered_by: string;
  trigger_type: string;
  status: string;
  discussion_started_at: string | null;
  voting_started_at: string | null;
  ejected_player_id: string | null;
  result_type: string | null;
  resolved_at: string | null;
};

type Room = {
  id: string;
  host_id: string;
  settings: {
    discussion_time?: number;
    voting_time?: number;
    anonymous_voting?: boolean;
    role_reveal?: boolean;
    impostor_count?: number;
  };
};

type Vote = {
  id: string;
  meeting_id: string;
  voter_id: string;
  target_id: string | null;
};

const DISCONNECTED_THRESHOLD_MS = 30000;
function isDisconnected(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() > DISCONNECTED_THRESHOLD_MS;
}

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c', Blue: '#3498db', Green: '#2ecc71',
    Purple: '#9b59b6', Yellow: '#f1c40f', Orange: '#e67e22',
    Pink: '#fd79a8', Cyan: '#00cec9', White: '#dfe6e9', Brown: '#a0522d',
  };
  return map[colorName] ?? '#888';
}

export default function MeetingScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [loading, setLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selectedTarget, setSelectedTarget] = useState<string | null | undefined>(undefined);
  const [hasVoted, setHasVoted] = useState(false);
  const hasMovedToVoting = useRef(false);
  const hasStartedDiscussionTimer = useRef(false);
  const hasResolvedVote = useRef(false);

useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 30000); // 30s — meetings are time-boxed, keep handoff snappy

const currentPlayer = players.find((p) => p.id === playerId);
  const isAlive = currentPlayer?.is_alive ?? false;
  // Derived from the players table (already kept in sync via realtime), not room.host_id —
  // this screen doesn't subscribe to the rooms table, so room.host_id would go stale after
  // a mid-meeting host promotion
  const isHost = currentPlayer?.is_host ?? false;

useFocusEffect(
    useCallback(() => {
      // Reset leftover state from a previous visit — critical for the ref flags, since a
      // second meeting reusing this same screen instance would otherwise inherit "already
      // resolved/already moved to voting" flags from the FIRST meeting and silently refuse
      // to progress the second one
      setHasVoted(false);
      setSelectedTarget(undefined);
      setSecondsLeft(0);
      setLoading(true);
      hasMovedToVoting.current = false;
      hasStartedDiscussionTimer.current = false;
      hasResolvedVote.current = false;

      fetchData();

      const channel = supabase
        .channel(`meeting:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'meetings', filter: `room_id=eq.${roomId}` },
          (payload) => {
            if (payload.new) {
              const updatedMeeting = payload.new as Meeting;
              setMeeting(updatedMeeting);
              if (updatedMeeting.resolved_at) {
                router.replace(`/results?roomId=${roomId}&playerId=${playerId}&meetingId=${updatedMeeting.id}`);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
          () => fetchPlayers()
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [roomId, playerId])
  );

  useEffect(() => {
    if (!meeting) return;

    const voteChannel = supabase
      .channel(`votes:${meeting.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `meeting_id=eq.${meeting.id}` },
        () => fetchVotes(meeting.id)
      )
      .subscribe();

    fetchVotes(meeting.id);

    return () => {
      supabase.removeChannel(voteChannel);
    };
  }, [meeting?.id]);

  // Only the host starts the discussion timer
  useEffect(() => {
    if (!isHost || !meeting || !room || hasStartedDiscussionTimer.current) return;

    if (meeting.status === 'discussion' && !meeting.discussion_started_at) {
      hasStartedDiscussionTimer.current = true;
      startDiscussionTimer();
    }
  }, [meeting, room, isHost]);

  useEffect(() => {
    if (loading || !meeting) return;

    const referenceTime = meeting.status === 'discussion'
      ? meeting.discussion_started_at
      : meeting.voting_started_at;

    if (!referenceTime) return;

    const totalDuration = meeting.status === 'discussion'
      ? (room?.settings.discussion_time ?? 60)
      : (room?.settings.voting_time ?? 60);

    const tick = () => {
      const elapsed = (Date.now() - new Date(referenceTime).getTime()) / 1000;
      const remaining = Math.max(0, Math.ceil(totalDuration - elapsed));
      setSecondsLeft(remaining);

      if (remaining <= 0 && meeting.status === 'discussion' && isHost && !hasMovedToVoting.current) {
        hasMovedToVoting.current = true;
        moveToVoting();
      }

      if (remaining <= 0 && meeting.status === 'voting' && isHost && !hasResolvedVote.current) {
        hasResolvedVote.current = true;
        resolveVote();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [meeting, room, loading, isHost]);

  // Host also checks if all active living players have voted, to end voting early.
  // Disconnected players don't block early resolution.
  useEffect(() => {
    if (!isHost || !meeting || meeting.status !== 'voting' || hasResolvedVote.current) return;

    const activeLivingPlayers = players.filter((p) => p.is_alive && !isDisconnected(p.last_seen));
    const votedPlayerIds = new Set(votes.map((v) => v.voter_id));
    const allVoted = activeLivingPlayers.length > 0 && activeLivingPlayers.every((p) => votedPlayerIds.has(p.id));

    if (allVoted) {
      hasResolvedVote.current = true;
      resolveVote();
    }
  }, [votes, players, meeting, isHost]);

  const fetchData = async () => {
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    const { data: meetingData } = await supabase
      .from('meetings')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (roomData) setRoom(roomData);
    if (meetingData) setMeeting(meetingData);

    await fetchPlayers();
    setLoading(false);
  };

const fetchPlayers = async () => {
    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (playersData) setPlayers(playersData);
  };

  const fetchVotes = async (meetingId: string) => {
    const { data: votesData } = await supabase
      .from('votes')
      .select('*')
      .eq('meeting_id', meetingId);

    if (votesData) {
      setVotes(votesData);
      const myVote = votesData.find((v) => v.voter_id === playerId);
      if (myVote) setHasVoted(true);
    }
  };

  const startDiscussionTimer = async () => {
    if (!meeting) return;
    await supabase
      .from('meetings')
      .update({ discussion_started_at: new Date().toISOString() })
      .eq('id', meeting.id);
  };

  const moveToVoting = async () => {
    if (!meeting) return;
    await supabase
      .from('meetings')
      .update({ status: 'voting', voting_started_at: new Date().toISOString() })
      .eq('id', meeting.id);
  };

  const resolveVote = async () => {
    if (!meeting) return;

    // Re-fetch the latest votes and players to make sure we have everything
    const { data: latestVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('meeting_id', meeting.id);

    const { data: latestPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId);

    const castVotes = latestVotes ?? [];
    const allPlayers = latestPlayers ?? [];

    // Tally votes (target_id null = skip)
    const tally: Record<string, number> = {};
    castVotes.forEach((v) => {
      const key = v.target_id ?? 'skip';
      tally[key] = (tally[key] ?? 0) + 1;
    });

    let ejectedId: string | null = null;
    let resultType: string = 'tie';

    const entries = Object.entries(tally);
    if (entries.length > 0) {
      const maxVotes = Math.max(...entries.map(([, count]) => count));
      const topEntries = entries.filter(([, count]) => count === maxVotes);

      if (topEntries.length === 1) {
        const [winnerKey] = topEntries[0];
        if (winnerKey === 'skip') {
          resultType = 'skipped';
        } else {
          ejectedId = winnerKey;
          resultType = 'ejected';
        }
      }
    }

    // Mark player as dead if ejected
    if (ejectedId) {
      await supabase
        .from('players')
        .update({ is_alive: false })
        .eq('id', ejectedId);
    }

    // Check win conditions using updated alive status
    const updatedPlayers = allPlayers.map((p) =>
      p.id === ejectedId ? { ...p, is_alive: false } : p
    );

    const ejectedPlayer = allPlayers.find((p) => p.id === ejectedId);
    let winner: string | null = null;
    const livingPlayers = updatedPlayers.filter((p) => p.is_alive);

    // Jester only wins by being voted out — surviving to the end (even as the last player)
    // is not a win condition for them, they just resolve under normal crewmate/impostor math
    if (ejectedPlayer?.role === 'jester') {
      winner = 'jester';
    } else {
      const livingImpostors = livingPlayers.filter((p) => p.role === 'impostor');
      const livingNonImpostors = livingPlayers.filter((p) => p.role !== 'impostor');

      if (livingImpostors.length === 0) {
        winner = 'crewmate';
      } else if (livingImpostors.length >= livingNonImpostors.length) {
        winner = 'impostor';
      }
    }

    await supabase
      .from('meetings')
      .update({
        ejected_player_id: ejectedId,
        result_type: resultType,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', meeting.id);

    // Always resolve the room status one way or the other — leaving it stuck on 'meeting'
    // would cause game.tsx's reconnect logic to bounce players back to gathering forever
    await supabase
      .from('rooms')
      .update({ status: winner ? 'ended' : 'in_progress', winner: winner ?? null })
      .eq('id', roomId);
  };

  const selectTarget = (targetId: string | null) => {
    if (hasVoted) return;
    setSelectedTarget(targetId);
  };

  const confirmVote = async () => {
    if (!meeting || hasVoted || selectedTarget === undefined) return;

    setHasVoted(true);

    await supabase
      .from('votes')
      .insert({
        meeting_id: meeting.id,
        voter_id: playerId,
        target_id: selectedTarget,
      });
  };

  if (loading || !meeting || !room) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  const isDiscussion = meeting.status === 'discussion';

  return (
    <View style={styles.container}>
      <Text style={styles.phaseLabel}>{isDiscussion ? 'Discussion' : 'Voting'}</Text>
      <Text style={styles.timer}>{secondsLeft}</Text>

      {!isDiscussion && isAlive && hasVoted && (
        <Text style={styles.votedBanner}>Your vote is locked in</Text>
      )}
      {!isDiscussion && !isAlive && (
        <Text style={styles.votedBanner}>You are dead and cannot vote</Text>
      )}

      <ScrollView style={styles.playerList} contentContainerStyle={styles.playerListContent}>
        {players.map((p) => {
          const canVoteForThis = !isDiscussion && isAlive && !hasVoted && p.is_alive;
          const isSelected = selectedTarget === p.id;

          return (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.playerRow,
                !p.is_alive && styles.deadRow,
                isSelected && styles.selectedRow,
              ]}
              disabled={!canVoteForThis}
              onPress={() => selectTarget(p.id)}
            >
              <View style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]} />
              <Text style={[styles.playerName, !p.is_alive && styles.deadText]}>
                {p.display_name}
              </Text>
              {!p.is_alive && <Text style={styles.deadLabel}>DEAD</Text>}
            </TouchableOpacity>
          );
        })}

        {!isDiscussion && isAlive && !hasVoted && (
          <TouchableOpacity
            style={[styles.playerRow, styles.skipRow, selectedTarget === null && styles.selectedRow]}
            onPress={() => selectTarget(null)}
          >
            <Text style={styles.skipText}>Skip Vote</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {!isDiscussion && isAlive && !hasVoted && selectedTarget !== undefined && (
        <TouchableOpacity style={styles.confirmButton} onPress={confirmVote}>
          <Text style={styles.confirmButtonText}>
            {selectedTarget === null
              ? 'Confirm Skip'
              : `Confirm Vote for ${players.find((p) => p.id === selectedTarget)?.display_name}`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
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
    flex: 1,
    backgroundColor: '#1a1a2e',
    padding: 24,
    alignItems: 'center',
  },
  phaseLabel: {
    color: '#aaaaaa',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 16,
  },
  timer: {
    fontSize: 56,
    fontWeight: 'bold',
    color: '#e74c3c',
    marginBottom: 12,
  },
  votedBanner: {
    color: '#2ecc71',
    fontSize: 14,
    marginBottom: 16,
    fontWeight: '600',
  },
  playerList: {
    width: '100%',
  },
  playerListContent: {
    gap: 8,
    paddingBottom: 16,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  deadRow: {
    opacity: 0.5,
  },
  selectedRow: {
    borderColor: '#e74c3c',
    borderWidth: 2,
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
  deadText: {
    textDecorationLine: 'line-through',
  },
  deadLabel: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: 'bold',
  },
  skipRow: {
    justifyContent: 'space-between',
    backgroundColor: '#0f3460',
  },
  skipText: {
    color: '#aaaaaa',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#e74c3c',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginTop: 16,
  },
  confirmButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});