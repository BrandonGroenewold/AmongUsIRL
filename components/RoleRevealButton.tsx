import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    Red: '#e74c3c', Blue: '#3498db', Green: '#2ecc71',
    Purple: '#9b59b6', Yellow: '#f1c40f', Orange: '#e67e22',
    Pink: '#fd79a8', Cyan: '#00cec9', White: '#dfe6e9', Brown: '#a0522d',
  };
  return map[colorName] ?? '#888';
}

function getRoleLabel(role: string): string {
  if (role === 'impostor') return 'Impostor';
  if (role === 'jester') return 'Jester';
  if (role === 'scientist') return 'Scientist';
  return 'Crewmate';
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
      style={styles.button}
    >
      {revealed ? (
        <View style={styles.revealedRow}>
          <View style={[styles.colorDot, { backgroundColor: getColorHex(color) }]} />
          <Text style={styles.name}>{displayName}</Text>
          <Text style={[
            styles.role,
            role === 'impostor' && styles.impostorRole,
            role === 'jester' && styles.jesterRole,
            role === 'scientist' && styles.scientistRole,
          ]}>
            {getRoleLabel(role)}
          </Text>
        </View>
      ) : (
        <Text style={styles.holdText}>Hold to see your role</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    minHeight: 40,
  },
  holdText: {
    color: '#555',
    fontSize: 13,
  },
  revealedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    color: '#aaaaaa',
    fontSize: 13,
    flex: 1,
  },
  role: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2ecc71',
  },
  impostorRole: {
    color: '#e74c3c',
  },
  jesterRole: {
    color: '#f1c40f',
  },
  scientistRole: {
    color: '#3498db',
  },
});