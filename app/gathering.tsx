import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
  const [hasTriggered, setHasTriggered] = useState(false);

  useHeartbeat(playerId);
  useHostFailover(roomId, players, playerId, 30000); // 30s — no task delay excuse during gathering, keep handoff snappy

  // Derived from the players table (already kept in sync via realtime), not room.host_id —
  // this screen doesn't subscribe to the rooms table, so room.host_id would go stale after
  // a mid-meeting host promotion
  const currentPlayer = players.find((p) => p.id === playerId);
  const isHost = currentPlayer?.is_host ?? false;

useFocusEffect(
    useCallback(() => {
      // Reset any leftover UI state from a previous visit to this screen
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

  // Only the host checks the timeout condition
  useEffect(() => {
    if (!isHost || hasTriggered) return;
    if (secondsLeft <= 0) {
      setHasTriggered(true);
      startDiscussion();
    }
  }, [secondsLeft, isHost, hasTriggered]);

  // Only the host checks the all-ready condition. Disconnected players don't block
  // early completion — only active living players need to be ready.
  useEffect(() => {
    if (!isHost || hasTriggered || loading) return;
    const activeLivingPlayers = players.filter((p) => p.is_alive && !isDisconnected(p.last_seen));
    const allReady = activeLivingPlayers.length > 0 && activeLivingPlayers.every((p) => p.ready_for_meeting);
    if (allReady) {
      setHasTriggered(true);
      startDiscussion();
    }
  }, [players, isHost, hasTriggered, loading]);

// Runs ONCE on mount: fetches room settings (sets the countdown starting point) and players
  const initialLoad = async () => {
    const { data: roomData } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (roomData) {
      setRoom(roomData);
      setSecondsLeft(roomData.settings.gathering_time ?? 45);
    }

    // Catch reconnecting after discussion has actually started. Meetings are created with
    // status 'discussion' from the moment they're triggered, so status alone can't tell us
    // whether gathering already finished — discussion_started_at is the real signal, since
    // it's only set once the timer genuinely begins.
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

  // Runs on every player change — does NOT touch the countdown
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
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  const activeLivingPlayers = players.filter((p) => p.is_alive && !isDisconnected(p.last_seen));
  const readyCount = activeLivingPlayers.filter((p) => p.ready_for_meeting).length;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Heading to Meeting</Text>
      <Text style={styles.subtitle}>Make your way to the meeting spot</Text>

      <Text style={styles.countdown}>{secondsLeft}</Text>
      <Text style={styles.countdownLabel}>seconds remaining</Text>

      <Text style={styles.readyCount}>{readyCount}/{activeLivingPlayers.length} players ready</Text>

      <TouchableOpacity
        style={[styles.readyButton, isReady && styles.readyButtonActive]}
        onPress={handleImHere}
        disabled={isReady}
      >
        <Text style={styles.readyButtonText}>{isReady ? "You're Ready ✓" : "I'm Here"}</Text>
      </TouchableOpacity>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    color: '#aaaaaa',
    fontSize: 16,
    marginBottom: 40,
  },
  countdown: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#f1c40f',
  },
  countdownLabel: {
    color: '#aaaaaa',
    fontSize: 14,
    marginBottom: 40,
  },
  readyCount: {
    color: '#ffffff',
    fontSize: 16,
    marginBottom: 24,
  },
  readyButton: {
    backgroundColor: '#16213e',
    borderWidth: 2,
    borderColor: '#e74c3c',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 8,
  },
  readyButtonActive: {
    backgroundColor: '#2ecc71',
    borderColor: '#2ecc71',
  },
  readyButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});