import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { supabase } from '../lib/supabase';

type Meeting = {
  id: string;
  ejected_player_id: string | null;
  result_type: string | null;
};

type Player = {
  id: string;
  display_name: string;
  role: string;
};

type Room = {
  id: string;
  status: string;
  winner: string | null;
  settings: {
    role_reveal?: boolean;
    impostor_count?: number;
  };
};

function getRoleLabel(role: string): string {
  if (role === 'impostor') return 'The Mole';
  if (role === 'jester') return 'Loose Cannon';
  if (role === 'scientist') return 'Hacker';
  return 'an Operative';
}

function getRoleColor(role: string): string {
  if (role === 'impostor') return '#E5383B';
  if (role === 'jester') return '#FFD60A';
  if (role === 'scientist') return '#22D3C8';
  return '#2CB67D';
}

export default function ResultsScreen() {
  const { roomId, playerId, meetingId } = useLocalSearchParams<{
    roomId: string;
    playerId: string;
    meetingId: string;
  }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [ejectedPlayer, setEjectedPlayer] = useState<Player | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [remainingImpostors, setRemainingImpostors] = useState(0);
  const [loading, setLoading] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(8);

  useHeartbeat(playerId);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (secondsLeft <= 0 && !loading) {
      proceedNext();
    }
  }, [secondsLeft, loading]);

  const fetchData = async () => {
    const { data: meetingData } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single();

    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (meetingData) {
      setMeeting(meetingData);

      if (meetingData.ejected_player_id) {
        const { data: playerData } = await supabase
          .from('players')
          .select('*')
          .eq('id', meetingData.ejected_player_id)
          .single();

        if (playerData) setEjectedPlayer(playerData);
      }
    }

    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: allPlayers } = await supabase
  .from('players')
  .select('*')
  .eq('room_id', roomId)
  .gte('last_seen', cutoff);

    if (allPlayers) {
      // Only count impostors who are alive AND actively connected/in the current game
      const remaining = allPlayers.filter(
        (p) => p.is_alive && p.role === 'impostor' && p.status === 'connected'
      ).length;
      setRemainingImpostors(remaining);
    }

    if (roomData) setRoom(roomData);
    setLoading(false);
  };

  const proceedNext = async () => {
    const { data: latestRoom } = await supabase
      .from('rooms')
      .select('status')
      .eq('id', roomId)
      .single();

    if (latestRoom?.status === 'ended') {
      router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
    } else {
      router.replace(`/game?roomId=${roomId}&playerId=${playerId}`);
    }
  };

  if (loading || !meeting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  const showRoleReveal = room?.settings.role_reveal ?? false;
  const isEjected = meeting.result_type === 'ejected' && ejectedPlayer;

  // Determine headline
  let headline = '';
  let subline = '';

  if (meeting.result_type === 'skipped') {
    headline = 'Vote Skipped';
    subline = 'No one was burned.';
  } else if (meeting.result_type === 'tie') {
    headline = 'Tied Vote';
    subline = 'A tie means no one gets burned.';
  } else if (isEjected) {
    headline = 'Burned';
    subline = `${ejectedPlayer.display_name} has been eliminated.`;
  }

  return (
    <View style={styles.container}>
      {/* Top accent bar */}
      <View style={styles.accentBar} />

      <View style={styles.inner}>
        {/* Debrief label */}
        <Text style={styles.eyebrow}>DEBRIEF RESULT</Text>

        {/* Headline */}
        <Text style={styles.headline}>{headline}</Text>
        <Text style={styles.subline}>{subline}</Text>

        {/* Role reveal card */}
        {isEjected && showRoleReveal && ejectedPlayer && (
          <View style={styles.roleCard}>
            <Text style={styles.roleCardLabel}>ROLE REVEALED</Text>
            <Text style={[styles.roleCardRole, { color: getRoleColor(ejectedPlayer.role) }]}>
              {getRoleLabel(ejectedPlayer.role)}
            </Text>

            {ejectedPlayer.role === 'impostor' && (
              <View style={styles.moleRemain}>
                <View style={styles.moleRemainDivider} />
                <Text style={styles.moleRemainText}>
                  {remainingImpostors} Mole{remainingImpostors !== 1 ? 's' : ''} still active
                </Text>
              </View>
            )}
          </View>
        )}

        {/* No reveal card */}
        {isEjected && !showRoleReveal && (
          <View style={styles.roleCard}>
            <Text style={styles.roleCardLabel}>ROLE</Text>
            <Text style={styles.roleCardUnknown}>Unknown</Text>
          </View>
        )}
      </View>

      {/* Countdown pill */}
      <View style={styles.countdownRow}>
        <View style={styles.countdownPill}>
          <Text style={styles.countdownNumber}>{secondsLeft}</Text>
          <Text style={styles.countdownLabel}>RETURNING</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#09091A',
  },
  accentBar: {
    height: 3,
    backgroundColor: '#F0B429',
    width: '100%',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  eyebrow: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 3,
    color: '#5A5A7A',
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 48,
    color: '#F0F0FA',
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: 10,
  },
  subline: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: '#5A5A7A',
    textAlign: 'center',
    marginBottom: 36,
  },

  // Role reveal card
  roleCard: {
    backgroundColor: '#16162A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingVertical: 28,
    paddingHorizontal: 40,
    alignItems: 'center',
    width: '100%',
  },
  roleCardLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 3,
    color: '#5A5A7A',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  roleCardRole: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 34,
    letterSpacing: 1,
  },
  roleCardUnknown: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 34,
    color: '#3A3A5A',
  },
  moleRemain: {
    alignItems: 'center',
    marginTop: 20,
    width: '100%',
  },
  moleRemainDivider: {
    height: 1,
    backgroundColor: '#22223A',
    width: '80%',
    marginBottom: 16,
  },
  moleRemainText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#E5383B',
  },

  // Countdown
  countdownRow: {
    alignItems: 'center',
    paddingBottom: 48,
  },
  countdownPill: {
    backgroundColor: '#16162A',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  countdownNumber: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 22,
    color: '#F0B429',
  },
  countdownLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 3,
    color: '#5A5A7A',
    textTransform: 'uppercase',
  },
});