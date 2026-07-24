import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-game" />
      <Stack.Screen name="join-game" />
      <Stack.Screen name="lobby" />
      <Stack.Screen name="role-reveal" />
      <Stack.Screen name="gathering" />
      <Stack.Screen name="meeting" />
      <Stack.Screen name="results" />
    </Stack>
  );
}