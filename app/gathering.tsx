import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useHeartbeat } from '../hooks/useHeartbeat';
import { useHostFailover } from '../hooks/useHostFailover';
import { supabase } from '../lib/supabase';

type Player = {
  id: string;
  display_name: string;
  color: string;
  is_alive: boolean;
  ready_for_meeting: boolean;
  is_host: boolean;
  last_seen: string;
  created_at: string;
};

type Room = {
  id: string;
  host_id: string;
  status: string;
  settings: {
    gathering_time?: number;
  };
};

const DISCONNECTED_THRESHOLD_MS = 30000;
function isDisconnected(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() > DISCONNECTED_THRESHOLD_MS;
}

export default function GatheringScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(45);
  const [totalSeconds, setTotalSeconds] = useState(45);
  const [hasTriggered, setHasTriggered] = useState(false);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 30000);

  const currentPlayer = players.find((p) => p.id === playerId);
  const isHost = currentPlayer?.is_host ?? false;

  useFocusEffect(
    useCallback(() => {
      setIsReady(false);
      setHasTriggered(false);
      setLoading(true);

      initialLoad();

      const playersChannel = supabase
        .channel(`gathering-players:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
          () => fetchPlayers()
        )
        .subscribe();

      const meetingChannel = supabase
        .channel(`gathering-meeting:${roomId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'meetings', filter: `room_id=eq.${roomId}` },
          (payload) => {
            if (payload.new && (payload.new as any).status === 'discussion') {
              router.replace(`/meeting?roomId=${roomId}&playerId=${playerId}`);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(playersChannel);
        supabase.removeChannel(meetingChannel);
      };
    }, [roomId, playerId])
  );

  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!isHost || hasTriggered) return;
    if (secondsLeft <= 0) {
      setHasTriggered(true);
      startDiscussion();
    }
  }, [secondsLeft, isHost, hasTriggered]);

  useEffect(() => {
    if (!isHost || hasTriggered || loading) return;
    const activeLivingPlayers = players.filter((p) => p.is_alive && !isDisconnected(p.last_seen));
    const allReady = activeLivingPlayers.length > 0 && activeLivingPlayers.every((p) => p.ready_for_meeting);
    if (allReady) {
      setHasTriggered(true);
      startDiscussion();
    }
  }, [players, isHost, hasTriggered, loading]);

  const initialLoad = async () => {
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (roomData) {
      setRoom(roomData);
      const secs = roomData.settings.gathering_time ?? 45;
      setSecondsLeft(secs);
      setTotalSeconds(secs);
    }

    const { data: latestMeeting } = await supabase
      .from('meetings')
      .select('status, discussion_started_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (latestMeeting && latestMeeting.discussion_started_at) {
      router.replace(`/meeting?roomId=${roomId}&playerId=${playerId}`);
      return;
    }

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

  const handleImHere = async () => {
    setIsReady(true);
    await supabase
      .from('players')
      .update({ ready_for_meeting: true })
      .eq('id', playerId);
  };

  const startDiscussion = async () => {
    await supabase
      .from('players')
      .update({ ready_for_meeting: false })
      .eq('room_id', roomId);

    await supabase
      .from('meetings')
      .update({ status: 'discussion' })
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(1);
  };

 if (loading) {
    return (
      <View style={styles.centered}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  if (!currentPlayer?.is_alive) {
    return (
      <View style={styles.centered}>
        <StatusBar style="light" />
        <Text style={styles.title}>Eliminated</Text>
        <Text style={styles.subtitle}>You're spectating this debrief</Text>
      </View>
    );
  }

  const activeLivingPlayers = players.filter((p) => p.is_alive && !isDisconnected(p.last_seen));
  const readyCount = activeLivingPlayers.filter((p) => p.ready_for_meeting).length;
  const alivePlayers = players.filter((p) => p.is_alive);
  const isUrgent = secondsLeft <= 10;
  const progressPercent = totalSeconds > 0 ? (secondsLeft / totalSeconds) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <Text style={styles.title}>Heading to{'\n'}Debrief</Text>
      <Text style={styles.subtitle}>Make your way to the meeting spot</Text>

      {/* Countdown card */}
      <View style={styles.countdownCard}>
        <Text style={[styles.countdownNumber, isUrgent && styles.countdownUrgent]}>
          {secondsLeft}
        </Text>
        <Text style={styles.countdownUnit}>SECONDS REMAINING</Text>

        {/* Depleting progress bar */}
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${progressPercent}%` as any },
              isUrgent && styles.progressUrgent,
            ]}
          />
        </View>
      </View>

      {/* Player ready dots */}
      <View style={styles.playersCard}>
        <Text style={styles.cardLabel}>PLAYERS READY</Text>

        <View style={styles.dotsWrap}>
          {alivePlayers.map((player) => {
            const disconnected = isDisconnected(player.last_seen);
            const ready = player.ready_for_meeting;
            return (
              <View
                key={player.id}
                style={[
                  styles.dot,
                  { backgroundColor: player.color },
                  ready && styles.dotReady,
                  disconnected && styles.dotDisconnected,
                ]}
              >
                {ready && <Text style={styles.dotCheck}>✓</Text>}
              </View>
            );
          })}
        </View>

        <Text style={styles.readyCount}>
          <Text style={styles.readyCountBold}>{readyCount}</Text>
          {' '}of {activeLivingPlayers.length} here
        </Text>
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={[styles.button, isReady && styles.buttonDone]}
        onPress={handleImHere}
        disabled={isReady}
        activeOpacity={0.85}
      >
        <Text style={[styles.buttonText, isReady && styles.buttonTextDone]}>
          {isReady ? "You're Here ✓" : "I'm Here"}
        </Text>
      </TouchableOpacity>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },

  // Header
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 36,
    color: '#F0F0FA',
    textAlign: 'center',
    lineHeight: 42,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#5A5A7A',
    textAlign: 'center',
    marginBottom: 32,
  },

  // Countdown card
  countdownCard: {
    width: '100%',
    backgroundColor: '#16162A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#22223A',
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  countdownNumber: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 88,
    color: '#F0B429',
    lineHeight: 96,
  },
  countdownUrgent: {
    color: '#E5383B',
  },
  countdownUnit: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
    marginTop: 2,
    marginBottom: 20,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: '#22223A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F0B429',
    borderRadius: 2,
  },
  progressUrgent: {
    backgroundColor: '#E5383B',
  },

  // Players card
  playersCard: {
    width: '100%',
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  cardLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
    marginBottom: 16,
  },
  dotsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  dot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotReady: {
    borderWidth: 3,
    borderColor: '#F0B429',
  },
  dotDisconnected: {
    opacity: 0.3,
  },
  dotCheck: {
    fontFamily: 'Nunito_900Black',
    fontSize: 18,
    color: '#09091A',
  },
  readyCount: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#5A5A7A',
  },
  readyCountBold: {
    fontFamily: 'Nunito_900Black',
    color: '#F0F0FA',
  },

  // Button
  button: {
    width: '100%',
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonDone: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#2CB67D',
    opacity: 0.35,
  },
  buttonText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 17,
    color: '#09091A',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  buttonTextDone: {
    color: '#2CB67D',
  },
});