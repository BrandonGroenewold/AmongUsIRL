import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_KEY = 'active_game_session';
const DEVICE_ID_KEY = 'device_id';

export type GameSession = {
  roomId: string;
  playerId: string;
  roomCode: string;
};

export async function saveSession(session: GameSession) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession(): Promise<GameSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameSession;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const newId = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
  return newId;
}