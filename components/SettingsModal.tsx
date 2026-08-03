import {
  BlackHanSans_400Regular,
  useFonts,
} from '@expo-google-fonts/black-han-sans';
import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_900Black,
} from '@expo-google-fonts/nunito';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

type Settings = {
  impostor_count?: number;
  task_count?: number;
  kill_cooldown?: number;
  discussion_time?: number;
  voting_time?: number;
  role_reveal?: boolean;
  emergency_meetings?: number;
  task_visibility?: string;
  tasks?: { name: string; location: string }[];
  jester_enabled?: boolean;
  scientist_enabled?: boolean;
  vitals_seconds_per_task?: number;
  vitals_min_open_cost?: number;
  anonymous_voting?: boolean;
  gathering_time?: number;
};

type Props = {
  visible: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
};

function NumberPicker({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix = '',
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  suffix?: string;
}) {
  return (
    <View style={styles.pickerRow}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <View style={styles.pickerControls}>
        <TouchableOpacity
          style={[styles.pickerButton, value <= min && styles.pickerButtonDisabled]}
          onPress={() => onChange(Math.max(min, value - step))}
          disabled={value <= min}
        >
          <Text style={styles.pickerButtonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.pickerValue}>
          {value}{suffix}
        </Text>
        <TouchableOpacity
          style={[styles.pickerButton, value >= max && styles.pickerButtonDisabled]}
          onPress={() => onChange(Math.min(max, value + step))}
          disabled={value >= max}
        >
          <Text style={styles.pickerButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Toggle({
  label,
  value,
  onToggle,
  hint,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  hint?: string;
}) {
  return (
    <View style={styles.pickerRow}>
      <View style={{ flex: 1, paddingRight: 16 }}>
        <Text style={styles.pickerLabel}>{label}</Text>
        {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      </View>
      <TouchableOpacity
        style={[styles.toggle, value && styles.toggleActive]}
        onPress={onToggle}
        activeOpacity={0.75}
      >
        <Text style={[styles.toggleText, value && styles.toggleTextActive]}>
          {value ? 'ON' : 'OFF'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function SettingsModal({ visible, settings, onClose, onSave }: Props) {
  const [local, setLocal] = useState<Settings>(settings);
  const [taskInput, setTaskInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [taskError, setTaskError] = useState('');
  const wasVisible = useRef(false);

  useFonts({
    BlackHanSans_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_900Black,
  });

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setLocal(settings);
    }
    wasVisible.current = visible;
  }, [visible, settings]);

  const update = (key: keyof Settings, value: any) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const addTask = () => {
    if (!taskInput.trim() || !locationInput.trim()) {
      setTaskError('Both assignment name and location are required.');
      return;
    }
    if ((local.tasks ?? []).length >= 15) {
      setTaskError('Maximum 15 assignments reached.');
      return;
    }
    update('tasks', [
      ...(local.tasks ?? []),
      { name: taskInput.trim(), location: locationInput.trim() },
    ]);
    setTaskInput('');
    setLocationInput('');
    setTaskError('');
  };

  const removeTask = (index: number) => {
    update('tasks', (local.tasks ?? []).filter((_, i) => i !== index));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>GAME SETTINGS</Text>
            <View style={styles.titleUnderline} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>

            {/* ── Core ─────────────────────────────────── */}
            <Text style={styles.sectionHeader}>CORE</Text>

            <NumberPicker
              label="Assignments per player"
              value={local.task_count ?? 3}
              min={1}
              max={8}
              onChange={(v) => update('task_count', v)}
            />
            <NumberPicker
              label="Burn cooldown"
              value={local.kill_cooldown ?? 30}
              min={10}
              max={60}
              step={5}
              suffix="s"
              onChange={(v) => update('kill_cooldown', v)}
            />
            <NumberPicker
              label="Emergency debriefs"
              value={local.emergency_meetings ?? 1}
              min={0}
              max={3}
              onChange={(v) => update('emergency_meetings', v)}
            />

            {/* ── Roles ────────────────────────────────── */}
            <Text style={styles.sectionHeader}>ROLES</Text>

            <NumberPicker
              label="Moles"
              value={local.impostor_count ?? 1}
              min={1}
              max={3}
              onChange={(v) => update('impostor_count', v)}
            />
            <Toggle
              label="Loose Cannon"
              value={local.jester_enabled ?? false}
              onToggle={() => update('jester_enabled', !local.jester_enabled)}
              hint="Neutral role — wins if voted out"
            />
            <Toggle
              label="Hacker"
              value={local.scientist_enabled ?? false}
              onToggle={() => update('scientist_enabled', !local.scientist_enabled)}
              hint="Operative who can check Pulse — earns views by completing assignments"
            />
            {local.scientist_enabled && (
              <>
                <NumberPicker
                  label="Seconds earned per assignment"
                  value={local.vitals_seconds_per_task ?? 10}
                  min={5}
                  max={30}
                  step={5}
                  suffix="s"
                  onChange={(v) => update('vitals_seconds_per_task', v)}
                />
                <NumberPicker
                  label="Min seconds to open Pulse"
                  value={local.vitals_min_open_cost ?? 3}
                  min={1}
                  max={10}
                  suffix="s"
                  onChange={(v) => update('vitals_min_open_cost', v)}
                />
              </>
            )}

            {/* ── Debriefs ─────────────────────────────── */}
            <Text style={styles.sectionHeader}>DEBRIEFS</Text>

            <NumberPicker
              label="Gathering time"
              value={local.gathering_time ?? 45}
              min={30}
              max={60}
              step={15}
              suffix="s"
              onChange={(v) => update('gathering_time', v)}
            />
            <NumberPicker
              label="Debrief time"
              value={local.discussion_time ?? 60}
              min={15}
              max={120}
              step={15}
              suffix="s"
              onChange={(v) => update('discussion_time', v)}
            />
            <NumberPicker
              label="Voting time"
              value={local.voting_time ?? 60}
              min={15}
              max={120}
              step={15}
              suffix="s"
              onChange={(v) => update('voting_time', v)}
            />
            <Toggle
              label="Anonymous voting"
              value={local.anonymous_voting ?? false}
              onToggle={() => update('anonymous_voting', !local.anonymous_voting)}
              hint="Players see vote counts only — not who voted for who"
            />

            {/* ── Ejections ────────────────────────────── */}
            <Text style={styles.sectionHeader}>EJECTIONS</Text>

            <Toggle
              label="Role reveal on burn"
              value={local.role_reveal ?? false}
              onToggle={() => update('role_reveal', !local.role_reveal)}
              hint="Shows burned player's role and remaining Mole count"
            />

            {/* ── Assignments ──────────────────────────── */}
            <Text style={styles.sectionHeader}>ASSIGNMENTS</Text>

            {/* Task visibility segmented control */}
            <View style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Task visibility</Text>
              <View style={styles.segmented}>
                {['Always', 'Meetings', 'Never'].map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[
                      styles.segment,
                      local.task_visibility === opt && styles.segmentActive,
                    ]}
                    onPress={() => update('task_visibility', opt)}
                  >
                    <Text
                      style={[
                        styles.segmentText,
                        local.task_visibility === opt && styles.segmentTextActive,
                      ]}
                    >
                      {opt.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Assignment pool */}
            <View style={styles.taskSection}>
              <Text style={styles.taskSectionLabel}>ASSIGNMENT POOL</Text>
              <Text style={styles.taskHint}>
                Players are randomly assigned {local.task_count ?? 3} of these
              </Text>

              {/* Add task inputs */}
              <View style={styles.taskInputRow}>
                <View style={styles.taskInputs}>
                  <Text style={styles.inputLabel}>ASSIGNMENT NAME</Text>
                  <TextInput
                    style={styles.taskInput}
                    placeholder="e.g. Fix the router..."
                    placeholderTextColor="#3A3A5A"
                    value={taskInput}
                    onChangeText={setTaskInput}
                  />
                  <Text style={[styles.inputLabel, { marginTop: 8 }]}>LOCATION</Text>
                  <TextInput
                    style={styles.taskInput}
                    placeholder="e.g. Server room..."
                    placeholderTextColor="#3A3A5A"
                    value={locationInput}
                    onChangeText={setLocationInput}
                    onSubmitEditing={addTask}
                  />
                </View>
                <TouchableOpacity style={styles.taskAddButton} onPress={addTask}>
                  <Text style={styles.taskAddText}>+</Text>
                </TouchableOpacity>
              </View>

              {taskError ? (
                <Text style={styles.taskError}>{taskError}</Text>
              ) : null}

              {/* Task list */}
              {(local.tasks ?? []).map((task: any, index: number) => (
                <View key={index} style={styles.taskRow}>
                  <View style={styles.taskDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskText}>{task.name}</Text>
                    <Text style={styles.taskLocation}>📍 {task.location}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => removeTask(index)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.taskDelete}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <Text style={styles.taskCount}>
                {(local.tasks ?? []).length} / 15 assignments
              </Text>
            </View>

            {/* Bottom breathing room */}
            <View style={{ height: 8 }} />
          </ScrollView>

          {/* Footer buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={() => onSave(local)} activeOpacity={0.85}>
              <Text style={styles.saveText}>SAVE</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#16162A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#22223A',
    padding: 24,
    paddingBottom: 32,
    maxHeight: '88%',
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontFamily: 'BlackHanSans_400Regular',
    fontSize: 22,
    color: '#F0F0FA',
    letterSpacing: 3,
    textAlign: 'center',
  },
  titleUnderline: {
    width: 48,
    height: 2,
    backgroundColor: '#F0B429',
    borderRadius: 1,
    marginTop: 8,
  },
  scroll: {
    flex: 1,
  },

  // Section header
  sectionHeader: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#F0B429',
    letterSpacing: 2.5,
    marginTop: 24,
    marginBottom: 2,
  },

  // NumberPicker / Toggle row
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  pickerLabel: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: '#F0F0FA',
    flex: 1,
  },
  settingHint: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: '#5A5A7A',
    marginTop: 3,
  },
  pickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerButton: {
    backgroundColor: '#1E1E30',
    borderWidth: 1,
    borderColor: '#22223A',
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonDisabled: {
    opacity: 0.35,
  },
  pickerButtonText: {
    fontFamily: 'Nunito_900Black',
    color: '#F0B429',
    fontSize: 18,
    lineHeight: 22,
  },
  pickerValue: {
    fontFamily: 'Nunito_900Black',
    color: '#F0F0FA',
    fontSize: 16,
    minWidth: 42,
    textAlign: 'center',
  },

  // Toggle
  toggle: {
    backgroundColor: '#1E1E30',
    borderWidth: 1,
    borderColor: '#22223A',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  toggleActive: {
    backgroundColor: '#F0B429',
    borderColor: '#F0B429',
  },
  toggleText: {
    fontFamily: 'Nunito_900Black',
    color: '#5A5A7A',
    fontSize: 12,
    letterSpacing: 1.5,
  },
  toggleTextActive: {
    color: '#09091A',
  },

  // Segmented control
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#22223A',
  },
  segment: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    backgroundColor: '#1E1E30',
  },
  segmentActive: {
    backgroundColor: '#F0B429',
  },
  segmentText: {
    fontFamily: 'Nunito_700Bold',
    color: '#5A5A7A',
    fontSize: 10,
    letterSpacing: 1,
  },
  segmentTextActive: {
    color: '#09091A',
  },

  // Footer buttons
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#22223A',
  },
  cancelText: {
    fontFamily: 'Nunito_900Black',
    color: '#5A5A7A',
    fontSize: 15,
    letterSpacing: 2,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: '#F0B429',
  },
  saveText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 15,
    letterSpacing: 2,
  },

  // Assignment pool
  taskSection: {
    paddingTop: 16,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
  },
  taskSectionLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: '#F0F0FA',
    letterSpacing: 2,
    marginBottom: 4,
  },
  taskHint: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 12,
    marginBottom: 14,
  },
  inputLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 10,
    color: '#5A5A7A',
    letterSpacing: 2,
    marginBottom: 6,
  },
  taskInputRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    alignItems: 'flex-end',
  },
  taskInputs: {
    flex: 1,
  },
  taskInput: {
    backgroundColor: '#09091A',
    borderWidth: 1,
    borderColor: '#22223A',
    borderRadius: 14,
    color: '#F0F0FA',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
  },
  taskAddButton: {
    backgroundColor: '#F0B429',
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  taskAddText: {
    fontFamily: 'Nunito_900Black',
    color: '#09091A',
    fontSize: 26,
    lineHeight: 30,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#22223A',
    gap: 10,
  },
  taskDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F0B429',
    marginRight: 2,
  },
  taskText: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#F0F0FA',
    fontSize: 14,
  },
  taskLocation: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 12,
    marginTop: 2,
  },
  taskDelete: {
    fontFamily: 'Nunito_700Bold',
    color: '#5A5A7A',
    fontSize: 14,
    paddingHorizontal: 6,
  },
  taskCount: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#5A5A7A',
    fontSize: 11,
    marginTop: 10,
    textAlign: 'right',
  },
  taskError: {
    fontFamily: 'Nunito_600SemiBold',
    color: '#E5383B',
    fontSize: 12,
    marginTop: 6,
    marginBottom: 4,
  },
});