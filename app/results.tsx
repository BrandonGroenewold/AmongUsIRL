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

export default function ResultsScreen() {
  const { roomId, playerId, meetingId } = useLocalSearchParams<{ roomId: string; playerId: string; meetingId: string }>();
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

  // Countdown ticks down only
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);

  // Navigation is a separate effect, triggered when countdown hits 0
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

    const { data: allPlayers } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId);

    if (allPlayers) {
      const remaining = allPlayers.filter((p) => p.is_alive && p.role === 'impostor').length;
      setRemainingImpostors(remaining);
    }

    if (roomData) setRoom(roomData);
    setLoading(false);
  };

  const proceedNext = () => {
    if (room?.status === 'ended') {
      router.replace(`/end-game?roomId=${roomId}&playerId=${playerId}`);
    } else {
      router.replace(`/game?roomId=${roomId}&playerId=${playerId}`);
    }
  };

  if (loading || !meeting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  const showRoleReveal = room?.settings.role_reveal ?? false;

  return (
    <View style={styles.container}>
      {meeting.result_type === 'skipped' && (
        <Text style={styles.resultText}>No one was ejected.</Text>
      )}

      {meeting.result_type === 'tie' && (
        <Text style={styles.resultText}>The vote was tied. No one was ejected.</Text>
      )}

      {meeting.result_type === 'ejected' && ejectedPlayer && (
        <>
          <Text style={styles.resultText}>{ejectedPlayer.display_name} was ejected.</Text>
          {showRoleReveal && (
            <>
              <Text style={styles.roleText}>
                They were {ejectedPlayer.role === 'impostor' ? 'an Impostor' : ejectedPlayer.role === 'jester' ? 'the Jester' : 'a Crewmate'}.
              </Text>
              {ejectedPlayer.role === 'impostor' && (
                <Text style={styles.subText}>{remainingImpostors} Impostor{remainingImpostors !== 1 ? 's' : ''} remain.</Text>
              )}
            </>
          )}
        </>
      )}

      <Text style={styles.countdown}>Returning in {secondsLeft}...</Text>
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
  resultText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
  },
  roleText: {
    fontSize: 18,
    color: '#e74c3c',
    fontWeight: '600',
    marginBottom: 4,
  },
  subText: {
    fontSize: 14,
    color: '#aaaaaa',
    marginBottom: 24,
  },
  countdown: {
    fontSize: 14,
    color: '#555',
    marginTop: 32,
  },
});