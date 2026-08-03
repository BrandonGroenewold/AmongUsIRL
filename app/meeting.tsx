import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RoleRevealButton from '../components/RoleRevealButton';
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
const REVEAL_DURATION_MS = 10000;

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
  const [showingReveal, setShowingReveal] = useState(false);

  const hasMovedToVoting = useRef(false);
  const hasStartedDiscussionTimer = useRef(false);
  const hasResolvedVote = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 30000);

  const currentPlayer = players.find((p) => p.id === playerId);
  const isAlive = currentPlayer?.is_alive ?? false;
  const isHost = currentPlayer?.is_host ?? false;
  const isAnonymousVoting = room?.settings?.anonymous_voting ?? false;

  // ── Computed vote tally: targetId (or 'skip') → array of votes ──────────
  const voteTally = useMemo(() => {
    const tally: Record<string, Vote[]> = {};
    votes.forEach((vote) => {
      const key = vote.target_id ?? 'skip';
      if (!tally[key]) tally[key] = [];
      tally[key].push(vote);
    });
    return tally;
  }, [votes]);

  const skipVotes = voteTally['skip'] ?? [];
  const ejectedPlayer = players.find((p) => p.id === meeting?.ejected_player_id);

  // ── Reveal banner config ─────────────────────────────────────────────────
  const revealResult = useMemo(() => {
    if (!showingReveal || !meeting) return null;
    switch (meeting.result_type) {
      case 'ejected':
        return {
          headline: ejectedPlayer?.display_name?.toUpperCase() ?? 'UNKNOWN',
          subline: 'HAS BEEN BURNED',
          color: '#E5383B',
          bgColor: 'rgba(229, 56, 59, 0.1)',
          borderColor: 'rgba(229, 56, 59, 0.32)',
        };
      case 'tie':
        return {
          headline: 'TIE',
          subline: 'NO BURN — NOBODY ESCAPES',
          color: '#F0B429',
          bgColor: 'rgba(240, 180, 41, 0.08)',
          borderColor: 'rgba(240, 180, 41, 0.28)',
        };
      case 'skipped':
        return {
          headline: 'SKIPPED',
          subline: 'THE OPERATIVES CHOSE SILENCE',
          color: '#5A5A7A',
          bgColor: 'rgba(90, 90, 122, 0.1)',
          borderColor: 'rgba(90, 90, 122, 0.28)',
        };
      default:
        return null;
    }
  }, [showingReveal, meeting, ejectedPlayer]);

  useFocusEffect(
    useCallback(() => {
      setHasVoted(false);
      setSelectedTarget(undefined);
      setSecondsLeft(0);
      setLoading(true);
      setShowingReveal(false);
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
                const meetingId = updatedMeeting.id;
                setShowingReveal(true);
                revealTimerRef.current = setTimeout(() => {
                  router.replace(
                    `/results?roomId=${roomId}&playerId=${playerId}&meetingId=${meetingId}`
                  );
                }, REVEAL_DURATION_MS);
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
        if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
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

  useEffect(() => {
    if (!isHost || !meeting || !room || hasStartedDiscussionTimer.current) return;

    if (meeting.status === 'discussion' && !meeting.discussion_started_at) {
      hasStartedDiscussionTimer.current = true;
      startDiscussionTimer();
    }
  }, [meeting, room, isHost]);

  useEffect(() => {
    if (loading || !meeting) return;

    const referenceTime =
      meeting.status === 'discussion'
        ? meeting.discussion_started_at
        : meeting.voting_started_at;

    if (!referenceTime) return;

    const totalDuration =
      meeting.status === 'discussion'
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

  useEffect(() => {
    if (!isHost || !meeting || meeting.status !== 'voting' || hasResolvedVote.current) return;

    const activeLivingPlayers = players.filter(
      (p) => p.is_alive && !isDisconnected(p.last_seen)
    );
    const votedPlayerIds = new Set(votes.map((v) => v.voter_id));
    const allVoted =
      activeLivingPlayers.length > 0 &&
      activeLivingPlayers.every((p) => votedPlayerIds.has(p.id));

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
    if (meetingData) {
      setMeeting(meetingData);
      // If meeting is already resolved on load, skip reveal and go straight to results
      if (meetingData.resolved_at) {
        router.replace(
          `/results?roomId=${roomId}&playerId=${playerId}&meetingId=${meetingData.id}`
        );
        return;
      }
    }

    await fetchPlayers();
    setLoading(false);
  };

  const fetchPlayers = async () => {
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .gte('last_seen', cutoff)
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

    const { data: latestVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('meeting_id', meeting.id);

    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: latestPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .gte('last_seen', cutoff);

    const castVotes = latestVotes ?? [];
    const allPlayers = latestPlayers ?? [];

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

    if (ejectedId) {
      await supabase
        .from('players')
        .update({ is_alive: false })
        .eq('id', ejectedId);
    }

    const updatedPlayers = allPlayers.map((p) =>
      p.id === ejectedId ? { ...p, is_alive: false } : p
    );

    const ejectedPlayerLocal = allPlayers.find((p) => p.id === ejectedId);
    let winner: string | null = null;
    const livingPlayers = updatedPlayers.filter((p) => p.is_alive);

    if (ejectedPlayerLocal?.role === 'jester') {
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

    await supabase.from('votes').insert({
      meeting_id: meeting.id,
      voter_id: playerId,
      target_id: selectedTarget,
    });
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading || !meeting || !room) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="light-content" backgroundColor="#09091A" />
        <ActivityIndicator size="large" color="#F0B429" />
        <Text style={styles.loadingText}>Assembling operatives…</Text>
      </View>
    );
  }

  const isDiscussion = meeting.status === 'discussion';
  const isUrgent = secondsLeft <= 15 && secondsLeft > 0;
  const targetPlayer = players.find((p) => p.id === selectedTarget);
  const livingPlayers = players.filter((p) => p.is_alive);
  const votesCast = votes.length;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#09091A" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.screenTitle}>DEBRIEF</Text>
        <View style={[
          styles.phaseBadge,
          !isDiscussion && !showingReveal && styles.phaseBadgeVoting,
          showingReveal && styles.phaseBadgeReveal,
        ]}>
          <Text style={[
            styles.phaseLabel,
            !isDiscussion && !showingReveal && styles.phaseLabelVoting,
            showingReveal && styles.phaseLabelReveal,
          ]}>
            {showingReveal ? 'RESULTS' : isDiscussion ? 'DISCUSSION' : 'VOTING'}
          </Text>
        </View>
      </View>

      {/* ── Timer OR Reveal Banner ── */}
      {showingReveal && revealResult ? (
        <View style={[
          styles.revealBanner,
          { backgroundColor: revealResult.bgColor, borderColor: revealResult.borderColor },
        ]}>
          <Text style={[styles.revealHeadline, { color: revealResult.color }]}>
            {revealResult.headline}
          </Text>
          <Text style={[styles.revealSubline, { color: revealResult.color }]}>
            {revealResult.subline}
          </Text>
          <Text style={styles.revealFooter}>→ Heading to results…</Text>
        </View>
      ) : (
        <View style={styles.timerContainer}>
          <Text style={[styles.timer, isUrgent && styles.timerUrgent]}>
            {secondsLeft}
          </Text>
          <Text style={styles.timerLabel}>seconds remaining</Text>
        </View>
      )}

      {/* ── Vote progress (voting phase only) ── */}
      {!isDiscussion && !showingReveal && (
        <View style={styles.voteProgressRow}>
          <View style={styles.voteProgressTrack}>
            {livingPlayers.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.voteProgressPip,
                  i < votesCast && styles.voteProgressPipFilled,
                ]}
              />
            ))}
          </View>
          <Text style={styles.voteProgressLabel}>
            {votesCast} / {livingPlayers.length} voted
          </Text>
        </View>
      )}

      {/* ── Voting mode indicator (reveal phase only) ── */}
      {showingReveal && (
        <View style={styles.votingModeBadge}>
          <Text style={styles.votingModeText}>
            {isAnonymousVoting ? '○  ANONYMOUS VOTING' : '●  VOTES REVEALED'}
          </Text>
        </View>
      )}

      {/* ── Role reveal ── */}
      {currentPlayer && (
        <RoleRevealButton
          displayName={currentPlayer.display_name}
          role={currentPlayer.role}
          color={currentPlayer.color}
        />
      )}

      {/* ── Status banners (non-reveal phases only) ── */}
      {!showingReveal && !isDiscussion && isAlive && hasVoted && (
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>✓  Vote locked in</Text>
        </View>
      )}
      {!showingReveal && !isDiscussion && !isAlive && (
        <View style={[styles.statusBanner, styles.statusBannerDead]}>
          <Text style={[styles.statusBannerText, styles.statusBannerDeadText]}>
            Eliminated — cannot vote
          </Text>
        </View>
      )}

      {/* ── Section label ── */}
      <Text style={styles.sectionLabel}>
        {showingReveal ? 'VOTE RESULTS' : 'OPERATIVES'}
      </Text>

      {/* ── Player list ── */}
      <ScrollView
        style={styles.playerList}
        contentContainerStyle={styles.playerListContent}
        showsVerticalScrollIndicator={false}
      >
        {players.map((p) => {
          const isBurned = showingReveal && meeting.ejected_player_id === p.id;
          const canVoteForThis =
            !isDiscussion &&
            isAlive &&
            !hasVoted &&
            p.is_alive &&
            !isDisconnected(p.last_seen) &&
            !showingReveal;
          const isSelected = selectedTarget === p.id;
          const votesForPlayer = voteTally[p.id] ?? [];
          const voteCount = votesForPlayer.length;

          return (
            <TouchableOpacity
              key={p.id}
              style={[
                styles.playerRow,
                !p.is_alive && !isBurned && styles.deadRow,
                isSelected && styles.selectedRow,
                isBurned && styles.burnedRow,
              ]}
              disabled={!canVoteForThis}
              onPress={() => selectTarget(p.id)}
              activeOpacity={0.7}
            >
              <View style={[styles.colorDot, { backgroundColor: getColorHex(p.color) }]} />

              {/* Name + vote tally column */}
              <View style={styles.playerInfoCol}>
                <View style={styles.playerRowTop}>
                  <Text style={[
                    styles.playerName,
                    !p.is_alive && !isBurned && styles.deadText,
                    isBurned && styles.burnedName,
                  ]}>
                    {p.display_name}
                  </Text>

                  {isBurned && (
                    <View style={styles.burnedBadge}>
                      <Text style={styles.burnedBadgeText}>BURNED</Text>
                    </View>
                  )}
                  {!p.is_alive && !isBurned && (
                    <View style={styles.deadBadge}>
                      <Text style={styles.deadBadgeText}>ELIMINATED</Text>
                    </View>
                  )}
                  {p.is_alive && isDisconnected(p.last_seen) && !showingReveal && (
                    <View style={styles.deadBadge}>
                      <Text style={[styles.deadBadgeText, { color: '#5A5A7A' }]}>OFFLINE</Text>
                    </View>
                  )}
                  {isSelected && !showingReveal && (
                    <View style={styles.selectedBadge}>
                      <Text style={styles.selectedBadgeText}>SELECTED</Text>
                    </View>
                  )}
                </View>

                {/* ── Vote dots (reveal phase) ── */}
                {showingReveal && voteCount > 0 && (
                  <View style={styles.voteDotRow}>
                    {isAnonymousVoting ? (
                      <View style={styles.voteCountBadge}>
                        <Text style={styles.voteCountBadgeText}>
                          {voteCount} {voteCount === 1 ? 'VOTE' : 'VOTES'}
                        </Text>
                      </View>
                    ) : (
                      votesForPlayer.map((vote) => {
                        const voter = players.find((pl) => pl.id === vote.voter_id);
                        return (
                          <View
                            key={vote.id}
                            style={[
                              styles.voteDot,
                              { backgroundColor: getColorHex(voter?.color ?? '') },
                            ]}
                          />
                        );
                      })
                    )}
                  </View>
                )}

                {/* No votes indicator */}
                {showingReveal && voteCount === 0 && p.is_alive && (
                  <Text style={styles.noVotesText}>no votes</Text>
                )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* ── Skip vote option (voting phase only) ── */}
        {!isDiscussion && isAlive && !hasVoted && !showingReveal && (
          <TouchableOpacity
            style={[
              styles.playerRow,
              styles.skipRow,
              selectedTarget === null && styles.selectedRow,
            ]}
            onPress={() => selectTarget(null)}
            activeOpacity={0.7}
          >
            <Text style={styles.skipText}>Skip Vote</Text>
          </TouchableOpacity>
        )}

        {/* ── Skip votes tally (reveal phase) ── */}
        {showingReveal && skipVotes.length > 0 && (
          <View style={[styles.playerRow, styles.skipRevealRow]}>
            <Text style={styles.skipRevealLabel}>SKIPPED</Text>
            <View style={styles.skipRevealRight}>
              {isAnonymousVoting ? (
                <View style={styles.voteCountBadge}>
                  <Text style={styles.voteCountBadgeText}>
                    {skipVotes.length} {skipVotes.length === 1 ? 'VOTE' : 'VOTES'}
                  </Text>
                </View>
              ) : (
                skipVotes.map((vote) => {
                  const voter = players.find((pl) => pl.id === vote.voter_id);
                  return (
                    <View
                      key={vote.id}
                      style={[
                        styles.voteDot,
                        { backgroundColor: getColorHex(voter?.color ?? '') },
                      ]}
                    />
                  );
                })
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Confirm button (voting phase only) ── */}
      {!isDiscussion && isAlive && !hasVoted && selectedTarget !== undefined && !showingReveal && (
        <TouchableOpacity
          style={[
            styles.confirmButton,
            selectedTarget === null && styles.confirmButtonSkip,
          ]}
          onPress={confirmVote}
          activeOpacity={0.85}
        >
          <Text style={[
            styles.confirmButtonText,
            selectedTarget === null && styles.confirmButtonTextSkip,
          ]}>
            {selectedTarget === null
              ? 'SKIP VOTE'
              : `BURN ${targetPlayer?.display_name?.toUpperCase() ?? ''}`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Loading ──────────────────────────────────────────────
  centered: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 14,
  },

  // ── Container ────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: '#09091A',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 24,
  },

  // ── Header ───────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  screenTitle: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 34,
    color: '#F0B429',
    letterSpacing: 1,
  },
  phaseBadge: {
    backgroundColor: '#16162A',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#22223A',
  },
  phaseBadgeVoting: {
    backgroundColor: 'rgba(229, 56, 59, 0.08)',
    borderColor: 'rgba(229, 56, 59, 0.35)',
  },
  phaseBadgeReveal: {
    backgroundColor: 'rgba(240, 180, 41, 0.08)',
    borderColor: 'rgba(240, 180, 41, 0.35)',
  },
  phaseLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
  },
  phaseLabelVoting: {
    color: '#E5383B',
  },
  phaseLabelReveal: {
    color: '#F0B429',
  },

  // ── Timer ────────────────────────────────────────────────
  timerContainer: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  timer: {
    fontFamily: 'Nunito_900Black',
    fontSize: 88,
    color: '#F0B429',
    lineHeight: 96,
  },
  timerUrgent: {
    color: '#E5383B',
  },
  timerLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: '#5A5A7A',
    letterSpacing: 1,
    marginTop: -4,
  },

  // ── Reveal Banner ─────────────────────────────────────────
  revealBanner: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 6,
    alignItems: 'center',
    gap: 3,
  },
  revealHeadline: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 30,
    letterSpacing: 1,
    textAlign: 'center',
  },
  revealSubline: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 2,
    opacity: 0.85,
    textAlign: 'center',
  },
  revealFooter: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: '#3A3A5A',
    marginTop: 8,
    letterSpacing: 0.5,
  },

  // ── Vote progress ─────────────────────────────────────────
  voteProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  voteProgressTrack: {
    flexDirection: 'row',
    gap: 5,
  },
  voteProgressPip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22223A',
    borderWidth: 1,
    borderColor: '#3A3A5A',
  },
  voteProgressPipFilled: {
    backgroundColor: '#F0B429',
    borderColor: '#F0B429',
  },
  voteProgressLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 1,
  },

  // ── Voting mode indicator ─────────────────────────────────
  votingModeBadge: {
    alignItems: 'center',
    marginBottom: 6,
  },
  votingModeText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#3A3A5A',
    letterSpacing: 1.5,
  },

  // ── Status banners ────────────────────────────────────────
  statusBanner: {
    backgroundColor: 'rgba(44, 182, 125, 0.1)',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(44, 182, 125, 0.28)',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBannerText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: '#2CB67D',
    letterSpacing: 1,
  },
  statusBannerDead: {
    backgroundColor: 'rgba(229, 56, 59, 0.07)',
    borderColor: 'rgba(229, 56, 59, 0.25)',
  },
  statusBannerDeadText: {
    color: '#E5383B',
  },

  // ── Section label ─────────────────────────────────────────
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
    marginBottom: 8,
    marginTop: 4,
  },

  // ── Player list ───────────────────────────────────────────
  playerList: {
    flex: 1,
  },
  playerListContent: {
    gap: 8,
    paddingBottom: 8,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16162A',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#22223A',
  },
  deadRow: {
    opacity: 0.38,
  },
  selectedRow: {
    borderColor: '#F0B429',
    borderWidth: 2,
    backgroundColor: 'rgba(240, 180, 41, 0.06)',
  },
  burnedRow: {
    borderColor: '#E5383B',
    borderWidth: 2,
    backgroundColor: 'rgba(229, 56, 59, 0.08)',
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 14,
    flexShrink: 0,
  },

  // ── Player info column ────────────────────────────────────
  playerInfoCol: {
    flex: 1,
    gap: 5,
  },
  playerRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerName: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#F0F0FA',
    fontSize: 16,
    flex: 1,
  },
  deadText: {
    textDecorationLine: 'line-through',
    color: '#5A5A7A',
  },
  burnedName: {
    color: '#E5383B',
  },

  // ── Badges ────────────────────────────────────────────────
  deadBadge: {
    backgroundColor: 'rgba(229, 56, 59, 0.12)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  deadBadgeText: {
    fontFamily: 'Nunito_700Bold',
    color: '#E5383B',
    fontSize: 10,
    letterSpacing: 1,
  },
  burnedBadge: {
    backgroundColor: 'rgba(229, 56, 59, 0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(229, 56, 59, 0.5)',
  },
  burnedBadgeText: {
    fontFamily: 'Nunito_700Bold',
    color: '#E5383B',
    fontSize: 10,
    letterSpacing: 1,
  },
  selectedBadge: {
    backgroundColor: 'rgba(240, 180, 41, 0.14)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  selectedBadgeText: {
    fontFamily: 'Nunito_700Bold',
    color: '#F0B429',
    fontSize: 10,
    letterSpacing: 1,
  },

  // ── Vote dots ─────────────────────────────────────────────
  voteDotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    alignItems: 'center',
  },
  voteDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  voteCountBadge: {
    backgroundColor: 'rgba(240, 180, 41, 0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(240, 180, 41, 0.28)',
  },
  voteCountBadgeText: {
    fontFamily: 'Nunito_700Bold',
    color: '#F0B429',
    fontSize: 10,
    letterSpacing: 1,
  },
  noVotesText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: '#3A3A5A',
    letterSpacing: 0.5,
  },

  // ── Skip row ──────────────────────────────────────────────
  skipRow: {
    justifyContent: 'center',
    borderStyle: 'dashed',
    borderColor: '#3A3A5A',
  },
  skipText: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 15,
    textAlign: 'center',
  },
  skipRevealRow: {
    justifyContent: 'space-between',
    borderStyle: 'dashed',
    borderColor: '#3A3A5A',
  },
  skipRevealLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: '#5A5A7A',
    letterSpacing: 1.5,
  },
  skipRevealRight: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    flexWrap: 'wrap',
  },

  // ── Confirm button ────────────────────────────────────────
  confirmButton: {
    backgroundColor: '#E5383B',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  confirmButtonSkip: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#F0B429',
  },
  confirmButtonText: {
    fontFamily: 'Nunito_900Black',
    color: '#F0F0FA',
    fontSize: 17,
    letterSpacing: 2,
  },
  confirmButtonTextSkip: {
    color: '#F0B429',
  },
});