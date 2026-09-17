import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, ScrollView, Pressable, TextInput, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { getAnswerKeys, saveAnswerKey } from '@/lib/storage';
import type { AnswerKey } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

const SUBJECTS = ['Math', 'Science', 'English', 'History', 'Geography', 'Physics', 'Chemistry', 'Biology', 'Other'];
const SETS = ['SET 1', 'SET 2', 'SET 3', 'SET 4', 'SET 5', 'SET 6'];
type AnswerOptions = string[];

export default function EditKeyScreen() {
  const insets = useSafeAreaInsets();
  const { keyId } = useLocalSearchParams<{ keyId?: string }>();
  const isEditing = !!keyId;

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('Math');
  const [totalQuestions, setTotalQuestions] = useState('30');
  const [optionsCount, setOptionsCount] = useState(6);
  const [marksPerQuestion, setMarksPerQuestion] = useState('3.0');

  const [answers, setAnswers] = useState<AnswerOptions[]>([]);
  const [multiSet, setMultiSet] = useState(false);
  const [activeSet, setActiveSet] = useState('SET 1');
  const [answersBySet, setAnswersBySet] = useState<Record<string, AnswerOptions[]>>({});

  useEffect(() => {
    if (keyId) {
      getAnswerKeys().then(keys => {
        const k = keys.find(x => x.id === keyId);
        if (k) {
          setName(k.name);
          setSubject(k.subject);
          setTotalQuestions(String(k.totalQuestions));
          setOptionsCount(k.optionsPerQuestion);
          setMarksPerQuestion(String(k.marksPerQuestion || 3.0));
          setAnswers(k.answers.map(answer => Array.isArray(answer) ? answer : [answer]));
          if (k.setAnswers) {
            setMultiSet(true);
            setAnswersBySet(k.setAnswers);
          }
        }
      });
    }
  }, [keyId]);

  const qCount = parseInt(totalQuestions) || 0;
  const optionLabels = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, optionsCount);
   const visibleAnswers = multiSet
    ? (answersBySet[activeSet] || answers)
    : answers;

  useEffect(() => {
    if (qCount <= 0) return;
    const normalize = (current: AnswerOptions[]) => {
      const arr = current.map(options => options.length ? options : ['A']);
      while (arr.length < qCount) arr.push(['A']);
      return arr.slice(0, qCount);
    };
    if (multiSet) {
      setAnswersBySet(prev => {
        const next = { ...prev };
        SETS.forEach(setName => {
          next[setName] = normalize(next[setName] || answers);
        });
        return next;
      });
    } else if (answers.length !== qCount) {
      setAnswers(prev => normalize(prev));
    }
  }, [qCount, multiSet, answers]);

  const enableMultiSet = () => {
    setAnswersBySet(prev => {
      const next = { ...prev };
      SETS.forEach(setName => {
        next[setName] = [...(next[setName] || answers)];
      });
      return next;
    });
    setMultiSet(true);
  };

  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSave = async () => {
    const keyName = name.trim() || `${subject} Exam ${new Date().toLocaleDateString()}`;
    if (qCount < 1 || qCount > 200) {
      showAlert('Invalid Questions', 'Enter between 1 and 200 questions.');
      return;
    }
    const marks = parseFloat(marksPerQuestion) > 0 ? parseFloat(marksPerQuestion) : 3.0;

    // Use current active answers as base template
    const baseAnswers = (multiSet ? (answersBySet[activeSet] || answersBySet['SET 1'] || answers) : answers).slice(0, qCount);

    // Build normalized set answers, filling any empty set from baseAnswers
    const normalizedSetAnswers = multiSet
      ? Object.fromEntries(SETS.map(setName => {
          const raw = (answersBySet[setName] || []).slice(0, qCount);
          const filled = Array.from({ length: qCount }, (_, i) => 
            (raw[i] && raw[i].length > 0) ? raw[i] : (baseAnswers[i] || ['A'])
          );
          return [setName, filled];
        }))
      : undefined;

    const defaultAnswers = (normalizedSetAnswers ? normalizedSetAnswers['SET 1'] : baseAnswers);

    const key: AnswerKey = {
      id: keyId || Crypto.randomUUID(),
      name: keyName,
      subject,
      totalQuestions: qCount,
      optionsPerQuestion: optionsCount,
      marksPerQuestion: marks,
      answers: defaultAnswers,
      ...(normalizedSetAnswers ? { setAnswers: normalizedSetAnswers } : {}),
      createdAt: new Date().toISOString(),
    };

    try {
      await saveAnswerKey(key);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err: any) {
      console.error('Error saving key:', err);
      showAlert('Save Error', err?.message || 'Could not save answer key');
    }
  };

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopInset }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit Key' : 'New Key'}</Text>
        <Pressable onPress={handleSave} hitSlop={12}>
          <Ionicons name="checkmark" size={26} color={C.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Midterm Exam 2024"
            placeholderTextColor={C.textLight}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Subject</Text>
          <View style={styles.chipRow}>
            {SUBJECTS.map(s => (
              <Pressable
                key={s}
                style={[styles.chip, subject === s && styles.chipActive]}
                onPress={() => {
                  setSubject(s);
                  Haptics.selectionAsync();
                }}
              >
                <Text style={[styles.chipText, subject === s && styles.chipTextActive]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Questions</Text>
            <TextInput
              style={styles.input}
              value={totalQuestions}
              onChangeText={setTotalQuestions}
              keyboardType="number-pad"
              placeholder="30"
              placeholderTextColor={C.textLight}
            />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Options</Text>
            <View style={styles.optionSelector}>
              {[3, 4, 5, 6].map(n => (
                <Pressable
                  key={n}
                  style={[styles.optionBtn, optionsCount === n && styles.optionBtnActive]}
                  onPress={() => {
                    setOptionsCount(n);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={[styles.optionBtnText, optionsCount === n && styles.optionBtnTextActive]}>
                    {n}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Marks/Q (T)</Text>
            <TextInput
              style={styles.input}
              value={marksPerQuestion}
              onChangeText={setMarksPerQuestion}
              keyboardType="decimal-pad"
              placeholder="3.0"
              placeholderTextColor={C.textLight}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Answer Key Type</Text>
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeButton, !multiSet && styles.modeButtonActive]}
              onPress={() => setMultiSet(false)}
            >
              <Text style={[styles.modeButtonText, !multiSet && styles.modeButtonTextActive]}>
                One set
              </Text>
            </Pressable>
            <Pressable
              style={[styles.modeButton, multiSet && styles.modeButtonActive]}
              onPress={enableMultiSet}
            >
              <Text style={[styles.modeButtonText, multiSet && styles.modeButtonTextActive]}>
                Six sets
              </Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>
            {multiSet
              ? 'Each scanned sheet is graded using the answer key for its detected set.'
              : 'Use this for a sheet with one answer pattern.'}
          </Text>
        </View>

        {qCount > 0 ? (
          <View style={styles.inputGroup}>
            <View style={styles.answerHeader}>
              <Text style={styles.label}>Answer Key</Text>
              {multiSet ? <Text style={styles.activeSetLabel}>{activeSet}</Text> : null}
            </View>
            {multiSet ? (
              <View style={styles.setTabs}>
                {SETS.map(setName => (
                  <Pressable
                    key={setName}
                    style={[styles.setTab, activeSet === setName && styles.setTabActive]}
                    onPress={() => setActiveSet(setName)}
                  >
                    <Text style={[styles.setTabText, activeSet === setName && styles.setTabTextActive]}>
                      {setName.replace('SET ', 'S')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.helperText}>Select one or more accepted choices for each question</Text>
            <View style={styles.answerGrid}>
              {visibleAnswers.slice(0, qCount).map((accepted, i) => (
                <View key={i} style={styles.answerItem}>
                  <Text style={styles.answerNum}>{i + 1}</Text>
                  <View style={styles.choiceRow}>
                    {optionLabels.map(option => {
                      const selected = accepted.includes(option);
                      return (
                        <Pressable
                          key={option}
                          style={[styles.choiceButton, selected && styles.choiceButtonActive]}
                          onPress={() => {
                            const nextAccepted = selected
                              ? accepted.filter(value => value !== option)
                              : [...accepted, option];
                            const newAnswers = [...visibleAnswers];
                            newAnswers[i] = nextAccepted;
                            if (multiSet) {
                              setAnswersBySet(prev => ({ ...prev, [activeSet]: newAnswers }));
                            } else {
                              setAnswers(newAnswers);
                            }
                            Haptics.selectionAsync();
                          }}
                        >
                          <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>
                            {option}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 18,
    color: C.text,
  },
  scroll: { paddingHorizontal: 20 },
  inputGroup: { marginBottom: 24 },
  label: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: C.text,
    marginBottom: 8,
  },
  helperText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: C.textSecondary,
    marginBottom: 12,
  },
  input: {
    backgroundColor: C.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Nunito_500Medium',
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
  },
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  chipTextActive: { color: C.white },
  row: {
    flexDirection: 'row',
    gap: 14,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
  },
  modeButtonActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  modeButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: C.text,
  },
  modeButtonTextActive: { color: C.white },
  answerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeSetLabel: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: C.primary,
    marginBottom: 8,
  },
  setTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  setTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  setTabActive: {
    backgroundColor: C.secondary,
    borderColor: C.secondary,
  },
  setTabText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.text,
  },
  setTabTextActive: { color: C.white },
  optionSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    alignItems: 'center',
  },
  optionBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  optionBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
  },
  optionBtnTextActive: { color: C.white },
  answerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  answerItem: {
    width: '100%',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  answerNum: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: C.textSecondary,
  },
  answerBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerBubbleText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 15,
    color: C.white,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 7,
    flexWrap: 'wrap',
  },
  choiceButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceButtonActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  choiceText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 13,
    color: C.textSecondary,
  },
  choiceTextActive: { color: C.white },
});
