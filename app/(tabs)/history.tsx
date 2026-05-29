import React, { useCallback, useRef, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, Pressable, Alert, Platform,
  Modal, TextInput, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { getScanResults, deleteScanResult } from '@/lib/storage';
import { getGrade, getGradeColor } from '@/lib/types';
import { PieChart } from '@/components/PieChart';
import { getApiUrl } from '@/lib/query-client';
import { authHeaders } from '@/lib/auth-token';
import type { ScanResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

function ResultCard({
  item,
  onDelete,
  onPress,
}: {
  item: ScanResult;
  onDelete: () => void;
  onPress: () => void;
}) {
  const grade = getGrade(item.percentage);
  const dateStr = new Date(item.scannedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Pressable
      style={({ pressed }) => [styles.resultCard, pressed && styles.pressed]}
      onPress={onPress}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert('Delete Result', 'Remove this scan result?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: onDelete },
        ]);
      }}
    >
      <View style={[styles.gradeCircle, { backgroundColor: getGradeColor(grade) }]}>
        <Text style={styles.gradeText}>{grade}</Text>
      </View>
      <View style={styles.resultContent}>
        <Text style={styles.resultName}>{item.answerKeyName}</Text>
        <Text style={styles.resultSubject}>{item.subject}</Text>
        <Text style={styles.resultDate}>{dateStr}</Text>
      </View>
      <View style={styles.resultScoreArea}>
        <Text style={styles.scorePercent}>{Math.round(item.percentage)}%</Text>
        <Text style={styles.scoreFraction}>{item.score}/{item.totalQuestions}</Text>
        <Ionicons name="lock-closed" size={12} color={C.textLight} style={{ marginTop: 4 }} />
      </View>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [results, setResults] = useState<ScanResult[]>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pwError, setPwError] = useState('');
  const inputRef = useRef<TextInput>(null);

  const loadResults = useCallback(async () => {
    const r = await getScanResults();
    setResults(r);
  }, []);

  useFocusEffect(useCallback(() => { loadResults(); }, [loadResults]));

  const handleDelete = async (id: string) => {
    await deleteScanResult(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    loadResults();
  };

  const openPasswordModal = (id: string) => {
    setPendingId(id);
    setPassword('');
    setPwError('');
    setShowPw(false);
    setModalVisible(true);
    setTimeout(() => inputRef.current?.focus(), 300);
  };

  const closeModal = () => {
    setModalVisible(false);
    setPendingId(null);
    setPassword('');
    setPwError('');
  };

  const handleVerify = async () => {
    if (!password) { setPwError('Enter your password to continue.'); return; }
    setVerifying(true);
    setPwError('');
    try {
      const res = await fetch(`${getApiUrl()}api/auth/verify`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setModalVisible(false);
        router.push({ pathname: '/scan-result', params: { resultId: pendingId } });
      } else {
        const data = await res.json();
        setPwError(data.error || 'Incorrect password.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch {
      setPwError('Connection error. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const gradeCount = results.reduce((acc, r) => {
    const g = getGrade(r.percentage);
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']
    .filter(g => gradeCount[g])
    .map(g => ({ label: g, value: gradeCount[g] || 0, color: getGradeColor(g as any) }));

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopInset }]}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>{results.length} total scans</Text>
      </View>

      <FlatList
        data={results}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ResultCard
            item={item}
            onDelete={() => handleDelete(item.id)}
            onPress={() => openPasswordModal(item.id)}
          />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!results.length}
        ListHeaderComponent={
          results.length > 1 ? (
            <View style={styles.chartCard}>
              <Text style={styles.chartTitle}>Grade Overview</Text>
              <PieChart data={pieData} size={120} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={64} color={C.primaryLight} />
            <Text style={styles.emptyTitle}>No scan history</Text>
            <Text style={styles.emptySubtitle}>
              Scanned answer sheets will appear here
            </Text>
          </View>
        }
      />

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="shield-checkmark" size={28} color={C.primary} />
            </View>
            <Text style={styles.modalTitle}>Password Required</Text>
            <Text style={styles.modalSubtitle}>
              Enter your account password to view this result
            </Text>

            {pwError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color={C.error} />
                <Text style={styles.errorText}>{pwError}</Text>
              </View>
            ) : null}

            <View style={styles.pwRow}>
              <Ionicons name="lock-closed-outline" size={18} color={C.textSecondary} />
              <TextInput
                ref={inputRef}
                style={styles.pwInput}
                value={password}
                onChangeText={text => { setPassword(text); setPwError(''); }}
                placeholder="Your password"
                placeholderTextColor={C.textLight}
                secureTextEntry={!showPw}
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={handleVerify}
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
                <Ionicons
                  name={showPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={C.textSecondary}
                />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.85 }]}
              onPress={handleVerify}
              disabled={verifying}
            >
              {verifying
                ? <ActivityIndicator color={C.white} />
                : <Text style={styles.verifyBtnText}>Unlock Result</Text>
              }
            </Pressable>

            <Pressable onPress={closeModal} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 28,
    color: C.text,
  },
  subtitle: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    gap: 12,
  },
  chartCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
    marginBottom: 16,
  },
  chartTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 16,
  },
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    gap: 12,
  },
  gradeCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: C.white,
  },
  resultContent: { flex: 1 },
  resultName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: C.text,
  },
  resultSubject: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  resultDate: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 11,
    color: C.textLight,
    marginTop: 4,
  },
  resultScoreArea: { alignItems: 'flex-end' },
  scorePercent: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: C.text,
  },
  scoreFraction: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 64,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 20,
    color: C.text,
  },
  emptySubtitle: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 14,
    color: C.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: C.card,
    borderRadius: 24,
    padding: 28,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    gap: 12,
  },
  modalIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: 'rgba(244,63,94,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 20,
    color: C.text,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
    width: '100%',
  },
  errorText: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.error,
    flex: 1,
  },
  pwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 13,
    width: '100%',
    marginTop: 4,
  },
  pwInput: {
    flex: 1,
    fontFamily: 'Nunito_500Medium',
    fontSize: 15,
    color: C.text,
  },
  verifyBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
  },
  verifyBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.white,
  },
  cancelBtn: {
    paddingVertical: 8,
  },
  cancelBtnText: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 14,
    color: C.textSecondary,
  },
});
