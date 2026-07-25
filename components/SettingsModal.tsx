import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
          style={styles.pickerButton}
          onPress={() => onChange(Math.max(min, value - step))}
        >
          <Text style={styles.pickerButtonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.pickerValue}>{value}{suffix}</Text>
        <TouchableOpacity
          style={styles.pickerButton}
          onPress={() => onChange(Math.min(max, value + step))}
        >
          <Text style={styles.pickerButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Toggle({ label, value, onToggle, hint }: { label: string; value: boolean; onToggle: () => void; hint?: string }) {
  return (
    <View style={styles.pickerRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pickerLabel}>{label}</Text>
        {hint ? <Text style={styles.settingHint}>{hint}</Text> : null}
      </View>
      <TouchableOpacity style={styles.toggle} onPress={onToggle}>
        <Text style={styles.toggleText}>{value ? 'On' : 'Off'}</Text>
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

  useEffect(() => {
    // Only reset local state when the modal transitions from closed -> open
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
      setTaskError('Both task name and location are required.');
      return;
    }
    if ((local.tasks ?? []).length >= 15) {
      setTaskError('Maximum 15 tasks reached.');
      return;
    }
    update('tasks', [...(local.tasks ?? []), { name: taskInput.trim(), location: locationInput.trim() }]);
    setTaskInput('');
    setLocationInput('');
    setTaskError('');
  };

  const removeTask = (index: number) => {
    update('tasks', (local.tasks ?? []).filter((_, i) => i !== index));
  };

  const handleSave = () => {
    onSave(local);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Game Settings</Text>
          <ScrollView>

            {/* Core Settings */}
            <Text style={styles.sectionHeader}>Core</Text>
            <NumberPicker
              label="Tasks per player"
              value={local.task_count ?? 3}
              min={1}
              max={8}
              onChange={(v) => update('task_count', v)}
            />
            <NumberPicker
              label="Kill cooldown"
              value={local.kill_cooldown ?? 30}
              min={10}
              max={60}
              step={5}
              suffix="s"
              onChange={(v) => update('kill_cooldown', v)}
            />
            <NumberPicker
              label="Emergency meetings"
              value={local.emergency_meetings ?? 1}
              min={0}
              max={3}
              onChange={(v) => update('emergency_meetings', v)}
            />

            {/* Roles */}
            <Text style={styles.sectionHeader}>Roles</Text>
            <NumberPicker
              label="Impostors"
              value={local.impostor_count ?? 1}
              min={1}
              max={3}
              onChange={(v) => update('impostor_count', v)}
            />
            <Toggle
              label="Jester"
              value={local.jester_enabled ?? false}
              onToggle={() => update('jester_enabled', !local.jester_enabled)}
              hint="Neutral role — wins if voted out"
            />
            <Toggle
              label="Scientist"
              value={local.scientist_enabled ?? false}
              onToggle={() => update('scientist_enabled', !local.scientist_enabled)}
              hint="Crewmate who can check vitals — earns views by completing tasks"
            />
            {local.scientist_enabled && (
              <>
                <NumberPicker
                  label="Seconds earned per task"
                  value={local.vitals_seconds_per_task ?? 10}
                  min={5}
                  max={30}
                  step={5}
                  suffix="s"
                  onChange={(v) => update('vitals_seconds_per_task', v)}
                />
                <NumberPicker
                  label="Min seconds to open vitals"
                  value={local.vitals_min_open_cost ?? 3}
                  min={1}
                  max={10}
                  suffix="s"
                  onChange={(v) => update('vitals_min_open_cost', v)}
                />
              </>
            )}

            {/* Meetings */}
            <Text style={styles.sectionHeader}>Meetings</Text>
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
              label="Discussion time"
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
              hint="Players see vote counts only, not who voted for who"
            />

            {/* Ejections */}
            <Text style={styles.sectionHeader}>Ejections</Text>
            <Toggle
              label="Role reveal on eject"
              value={local.role_reveal ?? false}
              onToggle={() => update('role_reveal', !local.role_reveal)}
              hint="Shows ejected player's role and impostor count"
            />

            {/* Tasks */}
            <Text style={styles.sectionHeader}>Tasks</Text>
            <View style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Task visibility</Text>
              <View style={styles.segmented}>
                {['Always', 'Meetings', 'Never'].map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.segment, local.task_visibility === opt && styles.segmentActive]}
                    onPress={() => update('task_visibility', opt)}
                  >
                    <Text style={[styles.segmentText, local.task_visibility === opt && styles.segmentTextActive]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Task Pool */}
            <View style={styles.taskSection}>
              <Text style={styles.taskSectionLabel}>Task Pool</Text>
              <Text style={styles.taskHint}>
                Players will be randomly assigned {local.task_count ?? 3} of these tasks
              </Text>

              <View style={styles.taskInputRow}>
                <View style={styles.taskInputs}>
                  <TextInput
                    style={styles.taskInput}
                    placeholder="Task name..."
                    placeholderTextColor="#888"
                    value={taskInput}
                    onChangeText={setTaskInput}
                  />
                  <TextInput
                    style={styles.taskInput}
                    placeholder="Location..."
                    placeholderTextColor="#888"
                    value={locationInput}
                    onChangeText={setLocationInput}
                    onSubmitEditing={addTask}
                  />
                </View>
                <TouchableOpacity style={styles.taskAddButton} onPress={addTask}>
                  <Text style={styles.taskAddText}>+</Text>
                </TouchableOpacity>
              </View>

              {(local.tasks ?? []).map((task: any, index: number) => (
                <View key={index} style={styles.taskRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskText}>{task.name}</Text>
                    <Text style={styles.taskLocation}>📍 {task.location}</Text>
                  </View>
                  <TouchableOpacity onPress={() => removeTask(index)}>
                    <Text style={styles.taskDelete}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {taskError ? <Text style={styles.taskError}>{taskError}</Text> : null}
              <Text style={styles.taskCount}>{(local.tasks ?? []).length}/15 tasks</Text>
            </View>

          </ScrollView>

          <View style={styles.buttons}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveText}>Save</Text>
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
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionHeader: {
    color: '#e74c3c',
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 4,
  },
  settingHint: {
    color: '#555',
    fontSize: 11,
    marginTop: 2,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  pickerLabel: {
    color: '#aaaaaa',
    fontSize: 15,
    flex: 1,
  },
  pickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pickerButton: {
    backgroundColor: '#0f3460',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  pickerValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'center',
  },
  toggle: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  toggleText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  segment: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0f3460',
  },
  segmentActive: {
    backgroundColor: '#e74c3c',
  },
  segmentText: {
    color: '#aaaaaa',
    fontSize: 13,
  },
  segmentTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  cancelText: {
    color: '#aaaaaa',
    fontSize: 16,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#e74c3c',
  },
  saveText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  taskSection: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  taskSectionLabel: {
    color: '#aaaaaa',
    fontSize: 15,
    marginBottom: 4,
  },
  taskHint: {
    color: '#555',
    fontSize: 12,
    marginBottom: 12,
  },
  taskInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  taskInputs: {
    flex: 1,
    gap: 8,
  },
  taskLocation: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  taskInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    color: '#ffffff',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  taskAddButton: {
    backgroundColor: '#e74c3c',
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskAddText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  taskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  taskText: {
    color: '#ffffff',
    fontSize: 14,
    flex: 1,
  },
  taskDelete: {
    color: '#e74c3c',
    fontSize: 16,
    paddingHorizontal: 8,
  },
  taskCount: {
    color: '#555',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'right',
  },
  taskError: {
    color: '#e74c3c',
    fontSize: 12,
    marginTop: 4,
  },
});