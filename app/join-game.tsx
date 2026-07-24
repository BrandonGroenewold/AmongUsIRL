import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PLAYER_COLORS } from '../constants/Colors';
import { saveSession } from '../lib/session';
import { supabase } from '../lib/supabase';

function getAvailableColor(preferred: string, taken: string[]): string {
  if (!taken.includes(preferred)) return preferred;
  const fallback = PLAYER_COLORS.find((c) => !taken.includes(c.name));
  return fallback?.name ?? preferred;
}

export default function JoinGameScreen() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    if (code.length !== 6) return;
    setLoading(true);
    setError('');

    const name = await AsyncStorage.getItem('player_name');
    const color = await AsyncStorage.getItem('player_color');

    if (!name || !color) {
      router.back();
      return;
    }

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .eq('status', 'lobby')
      .single();

    if (roomError || !room) {
      setError('Room not found. Check the code and try again.');
      setLoading(false);
      return;
    }

    const { data: existingPlayers } = await supabase
      .from('players')
      .select('color')
      .eq('room_id', room.id);

    const takenColors = existingPlayers?.map((p) => p.color) ?? [];
    const assignedColor = getAvailableColor(color, takenColors);

    const { data: player, error: playerError } = await supabase
      .from('players')
      .insert({
        room_id: room.id,
        display_name: name,
        color: assignedColor,
        is_host: false,
      })
      .select()
      .single();

if (playerError || !player) {
      setError('Failed to join room. Please try again.');
      setLoading(false);
      return;
    }

    await saveSession({ roomId: room.id, playerId: player.id, roomCode: room.code });

    router.replace(`/lobby?roomId=${room.id}&playerId=${player.id}`);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join Game</Text>

      <Text style={styles.label}>Room Code</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter 6-digit code"
        placeholderTextColor="#888"
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        maxLength={6}
        autoCapitalize="characters"
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color="#e74c3c" />
      ) : (
        <TouchableOpacity
          style={[styles.button, code.length !== 6 && styles.buttonDisabled]}
          onPress={handleJoin}
          disabled={code.length !== 6}
        >
          <Text style={styles.buttonText}>Join Room</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 32,
  },
  label: {
    color: '#aaaaaa',
    fontSize: 14,
    alignSelf: 'flex-start',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    width: '100%',
    backgroundColor: '#16213e',
    color: '#ffffff',
    borderRadius: 8,
    padding: 14,
    fontSize: 24,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
    textAlign: 'center',
    letterSpacing: 8,
  },
  error: {
    color: '#e74c3c',
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#e74c3c',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backText: {
    color: '#aaaaaa',
    fontSize: 16,
  },
});