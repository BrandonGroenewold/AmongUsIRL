import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type Player = {
  id: string;
  display_name: string;
  color: string;
  role: string;
};

type TeamConfig = {
  team: string;
  teamColor: string;
  teamDescription: string;
  roleName?: string;
  roleDescription?: string;
};

function getRoleConfig(role: string): TeamConfig {
  switch (role) {
    case 'crewmate':
      return {
        team: 'Operative',
        teamColor: '#3498db',
        teamDescription: 'Complete all assignments or work together to burn all Moles to win.',
      };
    case 'scientist':
      return {
        team: 'Operative',
        teamColor: '#3498db',
        teamDescription: 'Complete all assignments or work together to burn all Moles to win.',
        roleName: 'Hacker',
        roleDescription: 'Complete assignments to earn Pulse checks. Use them to see who is alive or dead in real time.',
      };
    case 'impostor':
      return {
        team: 'The Mole',
        teamColor: '#e74c3c',
        teamDescription: 'Eliminate Operatives without getting caught. Fake your assignments to blend in and avoid suspicion.',
      };
    case 'jester':
      return {
        team: 'Neutral',
        teamColor: '#9b59b6',
        teamDescription: 'You are not an Operative or a Mole.',
        roleName: 'Loose Cannon',
        roleDescription: 'Get yourself burned to win. Act suspicious enough to get voted out — but not too obvious.',
      };
    default:
      return {
        team: 'Operative',
        teamColor: '#3498db',
        teamDescription: 'Complete all assignments or work together to burn all Moles to win.',
      };
  }
}

export default function RoleRevealScreen() {
  const { roomId, playerId } = useLocalSearchParams<{ roomId: string; playerId: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [impostorTeammates, setImpostorTeammates] = useState<Player[]>([]);
  const [countdown, setCountdown] = useState(15);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRole();
  }, []);

useEffect(() => {
  if (loading) return;
  const timer = setInterval(() => {
    setCountdown((prev) => prev - 1);
  }, 1000);
  return () => clearInterval(timer);
}, [loading]);

useEffect(() => {
  if (countdown <= 0 && !loading) {
    navigateToGame();
  }
}, [countdown]);

  const fetchRole = async () => {
    const { data: playerData } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (playerData) {
      setPlayer(playerData);

      if (playerData.role === 'impostor') {
        const { data: teammates } = await supabase
          .from('players')
          .select('*')
          .eq('room_id', roomId)
          .eq('role', 'impostor')
          .neq('id', playerId);

        if (teammates) setImpostorTeammates(teammates);
      }
    }

    setLoading(false);
  };

  const navigateToGame = () => {
    router.replace(`/game?roomId=${roomId}&playerId=${playerId}`);
  };

  if (loading || !player) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#e74c3c" />
      </View>
    );
  }

  const config = getRoleConfig(player.role);

  return (
    <View style={styles.container}>

      {/* Team Section */}
      <Text style={styles.sectionLabel}>Your Team</Text>
      <Text style={[styles.teamName, { color: config.teamColor }]}>{config.team}</Text>
      <Text style={styles.teamDescription}>{config.teamDescription}</Text>

{/* Impostor teammates */}
      {player.role === 'impostor' && (
        <View style={styles.roleSection}>
          <Text style={styles.sectionLabel}>Your Teammates</Text>
          {impostorTeammates.length === 0 ? (
            <Text style={styles.teamDescription}>You are the sole Mole.</Text>
          ) : (
            impostorTeammates.map((t) => (
              <Text key={t.id} style={styles.roleName}>{t.display_name}</Text>
            ))
          )}
        </View>
      )}

      {/* Role Section (only if they have a special role) */}
      {config.roleName && (
        <View style={styles.roleSection}>
          <Text style={styles.sectionLabel}>Your Role</Text>
          <Text style={[styles.roleName, { color: config.teamColor }]}>{config.roleName}</Text>
          <Text style={styles.teamDescription}>{config.roleDescription}</Text>
        </View>
      )}

      {/* Got it button */}
      <TouchableOpacity
        style={[styles.button, { borderColor: config.teamColor }]}
        onPress={navigateToGame}
      >
        <Text style={[styles.buttonText, { color: config.teamColor }]}>
          Got it ({countdown})
        </Text>
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
    padding: 32,
  },
  sectionLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  teamName: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  teamDescription: {
    color: '#cccccc',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  roleSection: {
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 24,
    width: '100%',
    marginBottom: 24,
  },
  roleName: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoBox: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 24,
    borderWidth: 1,
  },
  infoLabel: {
    color: '#aaaaaa',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  infoText: {
    color: '#ffffff',
    fontSize: 16,
    paddingVertical: 4,
  },
  button: {
    borderWidth: 2,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginTop: 8,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
});