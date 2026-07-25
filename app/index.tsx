import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import HowToPlayModal from '../components/HowToPlayModal';
import { PLAYER_COLORS } from '../constants/Colors';
import { clearSession, getSession } from '../lib/session';
import { supabase } from '../lib/supabase';

export default function HomeScreen() {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState('Red');
  const [checkingSession, setCheckingSession] = useState(true);
  const [showHowToPlay, setShowHowToPlay] = useState(false);

  useEffect(() => {
    resumeSessionOrLoadProfile();
  }, []);

  const resumeSessionOrLoadProfile = async () => {
    const session = await getSession();

    if (session) {
      const { data: room } = await supabase
        .from('rooms')
        .select('id, status')
        .eq('id', session.roomId)
        .single();

      const { data: player } = await supabase
        .from('players')
        .select('id')
        .eq('id', session.playerId)
        .single();

      if (room && player && room.status !== 'ended') {
        // Note: if the room is mid-meeting, this currently sends the player back
        // into the main game screen rather than the exact meeting/voting sub-screen.
        const destination = room.status === 'lobby' ? 'lobby' : 'game';
        router.replace(`/${destination}?roomId=${session.roomId}&playerId=${session.playerId}`);
        return;
      }

      // Stale or invalid session — clear it and fall through to the normal Home screen
      await clearSession();
    }

    await loadProfile();
    setCheckingSession(false);
  };

  const loadProfile = async () => {
    const savedName = await AsyncStorage.getItem('player_name');
    const savedColor = await AsyncStorage.getItem('player_color');
    if (savedName) setName(savedName);
    if (savedColor) setSelectedColor(savedColor);
  };

  const saveAndNavigate = async (destination: '/create-game' | '/join-game') => {
    if (!name.trim()) return;
    await AsyncStorage.setItem('player_name', name.trim());
    await AsyncStorage.setItem('player_color', selectedColor);
    router.push(destination);
  };

if (checkingSession) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Trust No One</Text>

      <Text style={styles.label}>Your Name</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your name"
        placeholderTextColor="#888"
        value={name}
        onChangeText={setName}
        maxLength={16}
      />

      <Text style={styles.label}>Preferred Color</Text>
      <View style={styles.colorGrid}>
        {PLAYER_COLORS.map((color) => (
          <TouchableOpacity
            key={color.name}
            style={[
              styles.colorSwatch,
              { backgroundColor: color.hex },
              selectedColor === color.name && styles.colorSelected,
            ]}
            onPress={() => setSelectedColor(color.name)}
          />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.button, !name.trim() && styles.buttonDisabled]}
        onPress={() => saveAndNavigate('/create-game')}
        disabled={!name.trim()}
      >
        <Text style={styles.buttonText}>Create Game</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.buttonOutline, !name.trim() && styles.buttonDisabled]}
        onPress={() => saveAndNavigate('/join-game')}
        disabled={!name.trim()}
      >
        <Text style={styles.buttonOutlineText}>Join Game</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.howToPlayLink} onPress={() => setShowHowToPlay(true)}>
        <Text style={styles.howToPlayLinkText}>How to Play</Text>
      </TouchableOpacity>

      <HowToPlayModal visible={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 36,
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
    fontSize: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 32,
  },
  colorSwatch: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: '#ffffff',
    transform: [{ scale: 1.15 }],
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
  buttonOutline: {
    borderWidth: 2,
    borderColor: '#e74c3c',
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: '#e74c3c',
    fontSize: 18,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  howToPlayLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  howToPlayLinkText: {
    color: '#aaaaaa',
    fontSize: 15,
    textDecorationLine: 'underline',
  },
});