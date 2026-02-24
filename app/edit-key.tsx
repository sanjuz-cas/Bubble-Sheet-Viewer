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

export default function EditKeyScreen() {
  const insets = useSafeAreaInsets();
  const { keyId } = useLocalSearchParams<{ keyId?: string }>();
  const isEditing = !!keyId;

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('Math');
  const [totalQuestions, setTotalQuestions] = useState('30');
  const [optionsCount, setOptionsCount] = useState(4);
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    if (keyId) {
      getAnswerKeys().then(keys => {
        const k = keys.find(x => x.id === keyId);
        if (k) {
          setName(k.name);
          setSubject(k.subject);
          setTotalQuestions(String(k.totalQuestions));
          setOptionsCount(k.optionsPerQuestion);
          setAnswers(k.answers);
        }
      });
    }
  }, [keyId]);

  const qCount = parseInt(totalQuestions) || 0;
  const optionLabels = ['A', 'B', 'C', 'D', 'E'].slice(0, optionsCount);

  useEffect(() => {
    if (qCount > 0 && answers.length !== qCount) {
      setAnswers(prev => {
        const arr = [...prev];
        while (arr.length < qCount) arr.push('A');
        return arr.slice(0, qCount);
      });
    }
  }, [qCount]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter a name for this answer key.');
      return;
    }
    if (qCount < 1 || qCount > 200) {
      Alert.alert('Invalid Questions', 'Enter between 1 and 200 questions.');
      return;
    }

    const key: AnswerKey = {
      id: keyId || Crypto.randomUUID(),
      name: name.trim(),
      subject,
      totalQuestions: qCount,
      optionsPerQuestion: optionsCount,
      answers: answers.slice(0, qCount),
      createdAt: new Date().toISOString(),
    };

    await saveAnswerKey(key);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
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
              {[3, 4, 5].map(n => (
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
        </View>

        {qCount > 0 ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Answer Key</Text>
            <Text style={styles.helperText}>Tap to cycle through options for each question</Text>
            <View style={styles.answerGrid}>
              {answers.slice(0, qCount).map((ans, i) => (
                <Pressable
                  key={i}
                  style={styles.answerItem}
                  onPress={() => {
                    const currentIdx = optionLabels.indexOf(ans);
                    const nextIdx = (currentIdx + 1) % optionLabels.length;
                    const newAnswers = [...answers];
                    newAnswers[i] = optionLabels[nextIdx];
                    setAnswers(newAnswers);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={styles.answerNum}>{i + 1}</Text>
                  <View style={styles.answerBubble}>
                    <Text style={styles.answerBubbleText}>{ans}</Text>
                  </View>
                </Pressable>
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
    backgroundColor: C.white,
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
    backgroundColor: C.white,
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
  optionSelector: {
    flexDirection: 'row',
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.white,
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
    width: 58,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    backgroundColor: C.white,
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
});
