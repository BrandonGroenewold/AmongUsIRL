import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red:    '#E5383B',
    Blue:   '#3B82F6',
    Green:  '#2CB67D',
    Purple: '#9B59B6',
    Yellow: '#FFD60A',
    Orange: '#F97316',
    Pink:   '#F472B6',
    Cyan:   '#22D3C8',
    White:  '#E2E8F0',
    Brown:  '#92400E',
  };
  return map[colorName] ?? '#5A5A7A';
}

function getRoleLabel(role: string): string {
  if (role === 'impostor') return 'The Mole';
  if (role === 'jester') return 'Loose Cannon';
  if (role === 'scientist') return 'Hacker';
  return 'Operative';
}

function getRoleColor(role: string): string {
  if (role === 'impostor') return '#E5383B';
  if (role === 'jester') return '#FFD60A';
  if (role === 'scientist') return '#22D3C8';
  return '#2CB67D';
}

export default function RoleRevealButton({
  displayName,
  role,
  color,
}: {
  displayName: string;
  role: string;
  color: string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
     <Pressable
      onPressIn={() => setRevealed(true)}
      onPressOut={() => setRevealed(false)}
      // @ts-ignore — web pointer fallbacks for when re-render drops onPressOut
      onPointerUp={() => setRevealed(false)}
      onPointerLeave={() => setRevealed(false)}
      style={[styles.button, revealed && styles.buttonRevealed]}
    >
      {revealed ? (
        <View style={styles.revealedRow}>
          <View style={[styles.colorDot, { backgroundColor: getColorHex(color) }]} />
          <Text style={styles.name}>{displayName}</Text>
          <Text style={[styles.roleLabel, { color: getRoleColor(role) }]}>
            {getRoleLabel(role)}
          </Text>
        </View>
      ) : (
        <Text style={styles.holdText}>HOLD TO REVEAL YOUR ROLE</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#16162A',
    borderWidth: 1,
    borderColor: '#22223A',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 56,
  },
  // Gold border + elevated bg signals the card has "unlocked"
  buttonRevealed: {
    borderColor: '#F0B429',
    backgroundColor: '#1E1E30',
  },
  holdText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    letterSpacing: 2,
    color: '#5A5A7A',
  },
  revealedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  name: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
    flex: 1,
  },
  // BlackHanSans per design system: role names get the title treatment
  roleLabel: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 15,
  },
});