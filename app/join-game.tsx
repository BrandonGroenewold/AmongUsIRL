import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PLAYER_COLORS } from '../constants/Colors';
import { getDeviceId, getSession, saveSession } from '../lib/session';
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

    const existingSession = await getSession();
    if (existingSession && existingSession.roomCode === code) {
      router.replace(
        `/lobby?roomId=${existingSession.roomId}&playerId=${existingSession.playerId}`
      );
      return;
    }

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

    const deviceId = await getDeviceId();
    const bannedIds: string[] = room.banned_device_ids ?? [];
    if (bannedIds.includes(deviceId)) {
      setError('You have been banned from this room.');
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
        device_id: deviceId,
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

  const canJoin = code.length === 6;

  return (
    <View style={styles.container}>
      {/* Header */}
      <Text style={styles.title}>Join Game</Text>
      <Text style={styles.subtitle}>Enter the room code from your host</Text>

      {/* Form */}
      <View style={styles.form}>
        <Text style={styles.inputLabel}>ROOM CODE</Text>
        <TextInput
          style={styles.input}
          placeholder="······"
          placeholderTextColor="#3A3A5A"
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoFocus
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator size="large" color="#F0B429" style={styles.spinner} />
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, !canJoin && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={!canJoin}
          >
            <Text style={styles.primaryButtonText}>JOIN ROOM</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Back */}
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  // Header
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 36,
    color: '#F0F0FA',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#5A5A7A',
    marginBottom: 44,
    textAlign: 'center',
  },

  // Form
  form: {
    width: '100%',
    gap: 10,
  },
  inputLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 2,
  },
  input: {
    width: '100%',
    backgroundColor: '#16162A',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 20,
    fontSize: 30,
    fontFamily: 'Nunito_600SemiBold',
    color: '#F0F0FA',
    borderWidth: 1,
    borderColor: '#22223A',
    textAlign: 'center',
    letterSpacing: 12,
    marginBottom: 4,
  },
  error: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#E5383B',
    textAlign: 'center',
  },
  spinner: {
    marginVertical: 10,
  },

  // Buttons
  primaryButton: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  primaryButtonText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 17,
    letterSpacing: 2,
  },
  backButton: {
    marginTop: 32,
    padding: 8,
  },
  backText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#4A4A6A',
  },
});