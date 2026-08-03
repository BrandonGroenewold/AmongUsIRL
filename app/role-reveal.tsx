// role-reveal.tsx — full file replacement
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
        teamColor: '#2CB67D',
        teamDescription:
          'Complete all assignments or identify and burn every Mole to secure the mission.',
      };
    case 'scientist':
      return {
        team: 'Operative',
        teamColor: '#22D3C8',
        teamDescription:
          'Complete all assignments or identify and burn every Mole to secure the mission.',
        roleName: 'Hacker',
        roleDescription:
          'Complete assignments to earn Pulse checks. Use them to see who is alive or dead in real time.',
      };
    case 'impostor':
      return {
        team: 'The Mole',
        teamColor: '#E5383B',
        teamDescription:
          'Eliminate Operatives without getting caught. Fake your assignments to blend in and avoid suspicion.',
      };
    case 'jester':
      return {
        team: 'Neutral',
        teamColor: '#FFD60A',
        teamDescription: 'You answer to no one — not the Operatives, not the Mole.',
        roleName: 'Loose Cannon',
        roleDescription:
          'Get yourself burned to win. Act suspicious enough to get voted out — but not too obvious.',
      };
    default:
      return {
        team: 'Operative',
        teamColor: '#2CB67D',
        teamDescription:
          'Complete all assignments or identify and burn every Mole to secure the mission.',
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
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color="#F0B429" />
      </View>
    );
  }

  const config = getRoleConfig(player.role);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Signature element: role-colored dossier stripe */}
      <View style={[styles.accentBar, { backgroundColor: config.teamColor }]} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Eyebrow */}
        <Text style={styles.eyebrow}>ASSIGNMENT BRIEF</Text>

        {/* Team name */}
        <Text style={[styles.teamName, { color: config.teamColor }]}>
          {config.team}
        </Text>

        {/* Team description */}
        <View style={[styles.accentCard, { borderLeftColor: config.teamColor }]}>
          <Text style={styles.cardText}>{config.teamDescription}</Text>
        </View>

        {/* Special role block */}
        {config.roleName && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR ROLE</Text>
            <Text style={[styles.roleName, { color: config.teamColor }]}>
              {config.roleName}
            </Text>
            <View style={[styles.accentCard, { borderLeftColor: config.teamColor }]}>
              <Text style={styles.cardText}>{config.roleDescription}</Text>
            </View>
          </View>
        )}

        {/* Impostor network */}
        {player.role === 'impostor' && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR NETWORK</Text>
            {impostorTeammates.length === 0 ? (
              <View style={[styles.accentCard, { borderLeftColor: config.teamColor }]}>
                <Text style={styles.cardText}>You are the sole Mole. Trust no one.</Text>
              </View>
            ) : (
              <View style={styles.teammateList}>
                {impostorTeammates.map((t) => (
                  <View key={t.id} style={styles.teammateChip}>
                    <View style={[styles.colorDot, { backgroundColor: t.color }]} />
                    <Text style={styles.teammateName}>{t.display_name}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.spacer} />

        {/* Primary CTA */}
        <TouchableOpacity
          style={styles.button}
          onPress={navigateToGame}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>GOT IT ({countdown})</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#09091A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#09091A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accentBar: {
    height: 5,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 48,
    paddingBottom: 40,
  },
  eyebrow: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 3,
    marginBottom: 12,
  },
  teamName: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 54,
    lineHeight: 60,
    marginBottom: 20,
  },
  accentCard: {
    backgroundColor: '#16162A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22223A',
    borderLeftWidth: 3,
    padding: 16,
  },
  cardText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
    lineHeight: 24,
  },
  section: {
    marginTop: 36,
  },
  sectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    letterSpacing: 3,
    marginBottom: 10,
  },
  roleName: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 36,
    marginBottom: 12,
  },
  teammateList: {
    gap: 10,
  },
  teammateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16162A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22223A',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  teammateName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 16,
    color: '#F0F0FA',
  },
  spacer: {
    minHeight: 40,
    flex: 1,
  },
  button: {
    backgroundColor: '#F0B429',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: 'Nunito_900Black',
    fontSize: 17,
    color: '#09091A',
    letterSpacing: 2,
  },
});