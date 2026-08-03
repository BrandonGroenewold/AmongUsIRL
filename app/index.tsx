import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import HowToPlayModal from '../components/HowToPlayModal';
import { PLAYER_COLORS } from '../constants/Colors';
import { clearSession, getSession } from '../lib/session';
import { supabase } from '../lib/supabase';

function VaultIcon() {
  return (
    <Svg width={76} height={76} viewBox="0 0 100 100">
      {/* Outer ring */}
      <Circle cx="50" cy="50" r="46" stroke="#F0B429" strokeWidth="2.5" fill="#0D0D1A" />
      {/* Bolt dots at cardinal points */}
      <Circle cx="50" cy="8" r="4" fill="#F0B429" />
      <Circle cx="92" cy="50" r="4" fill="#F0B429" />
      <Circle cx="50" cy="92" r="4" fill="#F0B429" />
      <Circle cx="8" cy="50" r="4" fill="#F0B429" />
      {/* Middle wheel ring */}
      <Circle cx="50" cy="50" r="30" stroke="#F0B429" strokeWidth="2" fill="none" />
      {/* Cardinal spokes */}
      <Line x1="50" y1="20" x2="50" y2="38" stroke="#F0B429" strokeWidth="3" strokeLinecap="round" />
      <Line x1="80" y1="50" x2="62" y2="50" stroke="#F0B429" strokeWidth="3" strokeLinecap="round" />
      <Line x1="50" y1="80" x2="50" y2="62" stroke="#F0B429" strokeWidth="3" strokeLinecap="round" />
      <Line x1="20" y1="50" x2="38" y2="50" stroke="#F0B429" strokeWidth="3" strokeLinecap="round" />
      {/* Mystery mark */}
      <SvgText x="50" y="57" textAnchor="middle" fill="#F0B429" fontSize={22} fontWeight="bold">?</SvgText>
    </Svg>
  );
}

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
        .select('id, status, updated_at')
        .eq('id', session.roomId)
        .single();

      const { data: player } = await supabase
        .from('players')
        .select('id')
        .eq('id', session.playerId)
        .single();

      const TWO_HOURS = 2 * 60 * 60 * 1000;
      if (room && player && room.status !== 'ended' && (Date.now() - new Date(room.updated_at).getTime()) < TWO_HOURS) {
        const destination = room.status === 'lobby' ? 'lobby' : 'game';
        router.replace(`/${destination}?roomId=${session.roomId}&playerId=${session.playerId}`);
        return;
      }

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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

      {/* Logo */}
      <View style={styles.logoSection}>
        <VaultIcon />
        <Text style={styles.titleTrust}>TRUST</Text>
        <Text style={styles.titleNoOne}>NO ONE</Text>
        <Text style={styles.tagline}>CAN YOU SPOT THE MOLE?</Text>
      </View>

      {/* Form */}
      <View style={styles.formSection}>
        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your name"
          placeholderTextColor="#3A3A5A"
          value={name}
          onChangeText={setName}
          maxLength={16}
        />

        <Text style={styles.label}>YOUR COLOR</Text>
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
      </View>

      {/* Buttons */}
      <TouchableOpacity
        style={[styles.buttonPrimary, !name.trim() && styles.buttonDisabled]}
        onPress={() => saveAndNavigate('/create-game')}
        disabled={!name.trim()}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonPrimaryText}>HOST A HEIST</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.buttonSecondary, !name.trim() && styles.buttonDisabled]}
        onPress={() => saveAndNavigate('/join-game')}
        disabled={!name.trim()}
        activeOpacity={0.85}
      >
        <Text style={styles.buttonSecondaryText}>JOIN A HEIST</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.howToPlayLink} onPress={() => setShowHowToPlay(true)}>
        <Text style={styles.howToPlayText}>How to Play</Text>
      </TouchableOpacity>

      <HowToPlayModal visible={showHowToPlay} onClose={() => setShowHowToPlay(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    backgroundColor: '#09091A',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },

  // ── Logo ──────────────────────────────────────────
  logoSection: {
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 40,
  },
  titleTrust: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 52,
    color: '#F0F0FA',
    lineHeight: 52,
    marginTop: 16,
    letterSpacing: 3,
  },
  titleNoOne: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 52,
    color: '#F0B429',
    lineHeight: 52,
    letterSpacing: 3,
  },
  tagline: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#3A3A5A',
    letterSpacing: 3,
    marginTop: 12,
  },

  // ── Form ──────────────────────────────────────────
  formSection: {
    marginBottom: 24,
  },
  label: {
    fontFamily: 'Nunito_700Bold',
    color: '#5A5A7A',
    fontSize: 11,
    marginBottom: 10,
    letterSpacing: 2,
  },
  input: {
    width: '100%',
    backgroundColor: '#16162A',
    color: '#F0F0FA',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#22223A',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 32,
  },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  colorSelected: {
    borderWidth: 3,
    borderColor: '#F0B429',
    transform: [{ scale: 1.15 }],
  },

  // ── Buttons ───────────────────────────────────────
  buttonPrimary: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 14,
  },
  buttonPrimaryText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 17,
    letterSpacing: 2,
  },
  buttonSecondary: {
    borderWidth: 2,
    borderColor: '#F0B429',
    paddingVertical: 16,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 14,
  },
  buttonSecondaryText: {
    fontFamily: 'Nunito_900Black',
    color: '#F0B429',
    fontSize: 17,
    letterSpacing: 2,
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  howToPlayLink: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
  },
  howToPlayText: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#4A4A6A',
    fontSize: 14,
  },
});