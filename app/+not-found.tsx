// NEW
import {
  BlackHanSans_400Regular,
  useFonts,
} from '@expo-google-fonts/black-han-sans';
import {
  Nunito_600SemiBold,
  Nunito_900Black,
} from '@expo-google-fonts/nunito';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function NotFoundScreen() {
  const [fontsLoaded] = useFonts({
    BlackHanSans_400Regular,
    Nunito_900Black,
    Nunito_600SemiBold,
  });

  if (!fontsLoaded) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!', headerShown: false }} />
      <View style={styles.container}>
        <Text style={styles.code}>404</Text>
        <Text style={styles.title}>ACCESS DENIED</Text>
        <Text style={styles.subtitle}>
          This location doesn't exist — or someone burned it.
        </Text>

        <Link href="/" style={styles.button}>
          <Text style={styles.buttonText}>RETURN TO BASE</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  code: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 96,
    color: '#F0B429',
    opacity: 0.15,
    letterSpacing: 8,
    lineHeight: 100,
  },
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 32,
    color: '#F0F0FA',
    letterSpacing: 4,
    marginTop: -16,
    marginBottom: 12,
  },
  subtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#5A5A7A',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
    maxWidth: 260,
  },
  button: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    paddingHorizontal: 40,
    borderRadius: 16,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 17,
    color: '#09091A',
    letterSpacing: 2,
  },
});