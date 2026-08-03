import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type RoleEntry = {
  name: string;
  description: string;
  winCondition: string;
  color: string;
};

const HOW_TO_PLAY_SECTIONS = [
  {
    title: 'Objective',
    content:
      'Operatives must complete all their assignments or burn all Moles. Moles must eliminate enough Operatives to take control.',
  },
  {
    title: 'Assignments',
    content:
      'Operatives are assigned a list of assignments with locations. Find each location in real life and complete the assignment when you arrive. Tap to mark it done.',
  },
  {
    title: 'Debriefs',
    content:
      'Anyone can call an Emergency Debrief or report a body. During a debrief, discuss who you think the Mole is, then vote. Most votes gets burned — ties mean no one goes.',
  },
  {
    title: 'Eliminating',
    content:
      "Moles can eliminate Operatives. If you get eliminated, tap \"I Was Eliminated,\" then secretly identify who eliminated you. This info is only revealed at the end of the game.",
  },
  {
    title: 'Winning',
    content:
      'Operatives win by finishing all assignments or burning all Moles. Moles win when they match or outnumber the remaining Operatives. Some roles have unique win conditions — check the Roles tab.',
  },
];

const CREWMATE_ROLES: RoleEntry[] = [
  {
    name: 'Operative',
    description:
      "Complete your assignments and figure out who the Mole is. Burn them before it's too late.",
    winCondition: 'Win when all Moles are burned or all assignments are complete.',
    color: '#2CB67D',
  },
  {
    name: 'Hacker',
    description:
      "You're an Operative with a special ability. Complete assignments to bank time on your Pulse monitor, which shows who is alive or dead. Use it wisely.",
    winCondition: 'Share the Operative win condition.',
    color: '#22D3C8',
  },
];

const IMPOSTOR_ROLES: RoleEntry[] = [
  {
    name: 'The Mole',
    description: 'Blend in, fake your assignments, and eliminate Operatives without getting caught.',
    winCondition: 'Win when Moles match or outnumber remaining Operatives.',
    color: '#E5383B',
  },
];

const NEUTRAL_ROLES: RoleEntry[] = [
  {
    name: 'Loose Cannon',
    description: 'You have no assignments and no team. Act suspicious without being too obvious.',
    winCondition: 'Win only if the group burns you.',
    color: '#FFD60A',
  },
];

function RoleCard({ role }: { role: RoleEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={[styles.roleCard, expanded && styles.roleCardExpanded]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.75}
    >
      <View style={styles.roleCardHeader}>
        <View style={styles.roleNameRow}>
          <View style={[styles.roleColorDot, { backgroundColor: role.color }]} />
          <Text style={[styles.roleName, { color: role.color }]}>{role.name}</Text>
        </View>
        <Text style={styles.roleChevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      {expanded && (
        <View style={styles.roleCardBody}>
          <View style={[styles.roleDivider, { backgroundColor: role.color + '33' }]} />
          <Text style={styles.roleDescription}>{role.description}</Text>
          <View style={styles.winConditionRow}>
            <Text style={styles.winConditionIcon}>🏆</Text>
            <Text style={styles.roleWinCondition}>{role.winCondition}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HowToPlayModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'how' | 'roles'>('how');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <Text style={styles.title}>How to Play</Text>

          {/* Tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'how' && styles.tabActive]}
              onPress={() => setActiveTab('how')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'how' && styles.tabTextActive]}>
                HOW TO PLAY
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'roles' && styles.tabActive]}
              onPress={() => setActiveTab('roles')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'roles' && styles.tabTextActive]}>
                ROLES
              </Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.contentInner}
          >
            {activeTab === 'how' ? (
              HOW_TO_PLAY_SECTIONS.map((section, index) => (
                <View key={section.title} style={styles.section}>
                  <View style={styles.sectionTitleRow}>
                    <View style={styles.sectionAccentBar} />
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                  <Text style={styles.sectionContent}>{section.content}</Text>
                  {index < HOW_TO_PLAY_SECTIONS.length - 1 && (
                    <View style={styles.sectionDivider} />
                  )}
                </View>
              ))
            ) : (
              <>
                <Text style={styles.roleSectionHeader}>Operative Roles</Text>
                {CREWMATE_ROLES.map((role) => (
                  <RoleCard key={role.name} role={role} />
                ))}

                <Text style={styles.roleSectionHeader}>Mole Roles</Text>
                {IMPOSTOR_ROLES.map((role) => (
                  <RoleCard key={role.name} role={role} />
                ))}

                <Text style={styles.roleSectionHeader}>Neutral Roles</Text>
                {NEUTRAL_ROLES.map((role) => (
                  <RoleCard key={role.name} role={role} />
                ))}
              </>
            )}
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.closeText}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 26, 0.85)',
    justifyContent: 'flex-end',
  },

  // Modal shell
  modal: {
    backgroundColor: '#1E1E30',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#22223A',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 32,
    maxHeight: '88%',
  },

  // Title
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 26,
    color: '#F0F0FA',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 1,
  },

  // Tabs
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#16162A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#22223A',
    marginBottom: 20,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  tabActive: {
    backgroundColor: '#F0B429',
  },
  tabText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    letterSpacing: 2,
    color: '#5A5A7A',
  },
  tabTextActive: {
    color: '#09091A',
  },

  // Scrollable area
  content: {
    maxHeight: 420,
  },
  contentInner: {
    paddingBottom: 8,
  },

  // How to Play sections
  section: {
    marginBottom: 4,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionAccentBar: {
    width: 3,
    height: 14,
    backgroundColor: '#F0B429',
    borderRadius: 2,
    marginRight: 8,
  },
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#F0B429',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  sectionContent: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: '#F0F0FA',
    lineHeight: 22,
    paddingLeft: 11,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#22223A',
    marginTop: 16,
    marginBottom: 16,
  },

  // Roles tab — section headers
  roleSectionHeader: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#5A5A7A',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 8,
  },

  // Role card
  roleCard: {
    backgroundColor: '#16162A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#22223A',
    padding: 16,
    marginBottom: 8,
  },
  roleCardExpanded: {
    borderColor: '#2A2A44',
  },
  roleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleColorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roleName: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  roleChevron: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 10,
  },
  roleCardBody: {
    marginTop: 4,
  },
  roleDivider: {
    height: 1,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 1,
  },
  roleDescription: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#F0F0FA',
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 10,
  },
  winConditionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#09091A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  winConditionIcon: {
    fontSize: 13,
    lineHeight: 20,
  },
  roleWinCondition: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#F0F0FA',
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },

  // Close button — primary style
  closeButton: {
    backgroundColor: '#F0B429',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  closeText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 17,
    letterSpacing: 2,
  },
});