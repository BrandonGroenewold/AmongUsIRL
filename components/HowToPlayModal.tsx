import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type RoleEntry = {
  name: string;
  description: string;
  winCondition: string;
};

const HOW_TO_PLAY_SECTIONS = [
  {
    title: 'Objective',
    content: 'Operatives must complete all their assignments or burn all Moles. Moles must eliminate enough Operatives to take control.',
  },
  {
    title: 'Assignments',
    content: 'Operatives are assigned a list of assignments with locations. Find each location in real life and complete the assignment when you arrive. Tap to mark it done.',
  },
  {
    title: 'Debriefs',
    content: 'Anyone can call an Emergency Debrief or report a body. During a debrief, discuss who you think the Mole is, then vote. Most votes gets burned — ties mean no one goes.',
  },
  {
    title: 'Eliminating',
    content: 'Moles can eliminate Operatives. If you get eliminated, tap "I Was Eliminated," then secretly identify who eliminated you. This info is only revealed at the end of the game.',
  },
  {
    title: 'Winning',
    content: 'Operatives win by finishing all assignments or burning all Moles. Moles win when they match or outnumber the remaining Operatives. Some roles have unique win conditions — check the Roles tab to see how special roles win.',
  },
];

const CREWMATE_ROLES: RoleEntry[] = [
  {
    name: 'Operative',
    description: 'Complete your assignments and figure out who the Mole is. Burn them before it\'s too late.',
    winCondition: 'Win when all Moles are burned or all assignments are complete.',
  },
  {
    name: 'Hacker',
    description: 'You\'re an Operative with a special ability. Complete assignments to bank time on your Pulse monitor, which shows who is alive or dead. Use it wisely.',
    winCondition: 'Share the Operative win condition.',
  },
];

const IMPOSTOR_ROLES: RoleEntry[] = [
  {
    name: 'The Mole',
    description: 'Blend in, fake your assignments, and eliminate Operatives without getting caught.',
    winCondition: 'Win when Moles match or outnumber remaining Operatives.',
  },
];

const NEUTRAL_ROLES: RoleEntry[] = [
  {
    name: 'Loose Cannon',
    description: 'You have no assignments and no team. Act suspicious without being too obvious.',
    winCondition: 'Win only if the group burns you.',
  },
];

function RoleCard({ role }: { role: RoleEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity style={styles.roleCard} onPress={() => setExpanded(!expanded)}>
      <View style={styles.roleCardHeader}>
        <Text style={styles.roleName}>{role.name}</Text>
        <Text style={styles.roleChevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      {expanded && (
        <>
          <Text style={styles.roleDescription}>{role.description}</Text>
          <Text style={styles.roleWinCondition}>🏆 {role.winCondition}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

export default function HowToPlayModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'how' | 'roles'>('how');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>How to Play</Text>

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'how' && styles.tabActive]}
              onPress={() => setActiveTab('how')}
            >
              <Text style={[styles.tabText, activeTab === 'how' && styles.tabTextActive]}>How to Play</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'roles' && styles.tabActive]}
              onPress={() => setActiveTab('roles')}
            >
              <Text style={[styles.tabText, activeTab === 'roles' && styles.tabTextActive]}>Roles</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {activeTab === 'how' ? (
              HOW_TO_PLAY_SECTIONS.map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionContent}>{section.content}</Text>
                </View>
              ))
            ) : (
              <>
                <Text style={styles.roleSectionHeader}>Operative Roles</Text>
                {CREWMATE_ROLES.map((role) => <RoleCard key={role.name} role={role} />)}
                <Text style={styles.roleSectionHeader}>Mole Roles</Text>
                {IMPOSTOR_ROLES.map((role) => <RoleCard key={role.name} role={role} />)}
                <Text style={styles.roleSectionHeader}>Neutral Roles</Text>
                {NEUTRAL_ROLES.map((role) => <RoleCard key={role.name} role={role} />)}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '85%',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 16,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#0f3460',
  },
  tabActive: {
    backgroundColor: '#e74c3c',
  },
  tabText: {
    color: '#aaaaaa',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  content: {
    maxHeight: 420,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#e74c3c',
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sectionContent: {
    color: '#cccccc',
    fontSize: 14,
    lineHeight: 22,
  },
  roleSectionHeader: {
    color: '#e74c3c',
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 8,
  },
  roleCard: {
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  roleCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roleName: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  roleChevron: {
    color: '#aaaaaa',
    fontSize: 12,
  },
  roleDescription: {
    color: '#cccccc',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  roleWinCondition: {
    color: '#2ecc71',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '600',
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: '#0f3460',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});