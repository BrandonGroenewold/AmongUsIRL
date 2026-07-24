import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PLAYER_COLORS } from '../constants/Colors';
import { getDeviceId, saveSession } from '../lib/session';
import { supabase } from '../lib/supabase';

function getAvailableColor(preferred: string, taken: string[]): string {
  if (!taken.includes(preferred)) return preferred;
  const fallback = PLAYER_COLORS.find((c) => !taken.includes(c.name));
  return fallback?.name ?? preferred;
}

export default function CreateGameScreen() {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    createRoom();
  }, []);

  const createRoom = async () => {
    setLoading(true);

    const name = await AsyncStorage.getItem('player_name');
    const color = await AsyncStorage.getItem('player_color');

    if (!name || !color) {
      router.back();
      return;
    }

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert({ code, status: 'lobby', settings: {} })
      .select()
      .single();

    if (roomError || !room) {
      console.error('Failed to create room', roomError);
      setLoading(false);
      return;
    }

    const { data: existingPlayers } = await supabase
      .from('players')
      .select('color')
      .eq('room_id', room.id);

    const takenColors = existingPlayers?.map((p) => p.color) ?? [];
    const assignedColor = getAvailableColor(color, takenColors);

    const deviceId = await getDeviceId();

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        room_id: room.id,
        display_name: name,
        color: assignedColor,
        is_host: true,
        device_id: deviceId,
      })
      .select()
      .single();

    if (playerError || !player) {
      console.error('Failed to create player', playerError);
      setLoading(false);
      return;
    }

    await supabase
      .from('rooms')
      .update({ host_id: player.id })
      .eq('id', room.id);

    await saveSession({ roomId: room.id, playerId: player.id, roomCode: room.code });

    router.replace(`/lobby?roomId=${room.id}&playerId=${player.id}`);
  };

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#e74c3c" />
      <Text style={styles.text}>Creating room...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    color: '#aaaaaa',
    fontSize: 16,
  },
});