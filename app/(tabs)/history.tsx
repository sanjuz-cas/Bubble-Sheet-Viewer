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
import { authHeaders, getAuthToken } from '@/lib/auth-token';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { ScanResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

function formatMark(value: number): string {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

import { sortResultsByRollNumber, generateTeacherCSV, generateStudentCSV, generateRollWiseCSV, downloadCSV } from '@/lib/export-utils';

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
        <View style={styles.cardHeaderRow}>
          <Text style={styles.resultName}>{item.answerKeyName}</Text>
          {item.detectedRollNumber ? (
            <View style={styles.rollBadge}>
              <Text style={styles.rollBadgeText}>Roll: {item.detectedRollNumber}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.resultSubject}>
          {item.subject} {item.detectedSet ? `· ${item.detectedSet}` : ''}
        </Text>
        <Text style={styles.resultDate}>{dateStr}</Text>
      </View>
      <View style={styles.resultScoreArea}>
        <Text style={styles.scorePercent}>{Math.round(item.percentage)}%</Text>
        <Text style={styles.scoreFraction}>
          {formatMark(item.score)}/{formatMark(item.totalMarks)}
        </Text>
        <Ionicons name="lock-closed" size={12} color={C.textLight} style={{ marginTop: 4 }} />
      </View>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [results, setResults] = useState<ScanResult[]>([]);
  const [sortByRoll, setSortByRoll] = useState(false);

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

  const handleExportTeacherCSV = async () => {
    if (results.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const csvData = generateTeacherCSV(results, 'Complete Evaluation Ledger');
    await downloadCSV(csvData, 'omr_teacher_master_ledger.csv');
  };

  const handleExportStudentCSV = async () => {
    if (results.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const csvData = generateStudentCSV(results, 'Complete Student Scorecards');
    await downloadCSV(csvData, 'omr_student_scorecards.csv');
  };

  const handleExportPDFDossier = async () => {
    if (results.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const baseUrl = getApiUrl();
      const token = getAuthToken();
      const ids = results.map(r => r.id).join(',');
      const url = `${baseUrl}api/results/export/pdf?ids=${encodeURIComponent(ids)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        const fileUri = `${FileSystem.cacheDirectory}omr_master_dossier.pdf`;
        const downloadRes = await FileSystem.downloadAsync(url, fileUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadRes.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Export OMR Master PDF Dossier',
          });
        }
      }
    } catch (e: any) {
      Alert.alert('PDF Export Error', e.message || 'Could not generate PDF dossier.');
    }
  };

  const displayedResults = sortByRoll ? sortResultsByRollNumber(results) : results;

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
        <View>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>{results.length} total scans</Text>
        </View>
        {results.length > 0 ? (
          <View style={styles.headerExports}>
            <Pressable
              style={({ pressed }) => [styles.miniExportBtn, styles.teacherBtnBg, pressed && styles.pressed]}
              onPress={handleExportTeacherCSV}
            >
              <Ionicons name="analytics-outline" size={13} color={C.white} />
              <Text style={styles.miniExportText}>Teacher</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.miniExportBtn, styles.studentBtnBg, pressed && styles.pressed]}
              onPress={handleExportStudentCSV}
            >
              <Ionicons name="school-outline" size={13} color={C.white} />
              <Text style={styles.miniExportText}>Student</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.miniExportBtn, styles.pdfBtnBg, pressed && styles.pressed]}
              onPress={handleExportPDFDossier}
            >
              <Ionicons name="document-text-outline" size={13} color={C.white} />
              <Text style={styles.miniExportText}>PDF Dossier</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {results.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterChip, !sortByRoll && styles.filterChipActive]}
            onPress={() => setSortByRoll(false)}
          >
            <Ionicons name="time-outline" size={14} color={!sortByRoll ? C.white : C.textSecondary} />
            <Text style={[styles.filterChipText, !sortByRoll && styles.filterChipTextActive]}>
              Newest First
            </Text>
          </Pressable>
          <Pressable
            style={[styles.filterChip, sortByRoll && styles.filterChipActive]}
            onPress={() => setSortByRoll(true)}
          >
            <Ionicons name="list-outline" size={14} color={sortByRoll ? C.white : C.textSecondary} />
            <Text style={[styles.filterChipText, sortByRoll && styles.filterChipTextActive]}>
              Sort by Roll No.
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={displayedResults}
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
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerExports: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
  },
  teacherBtnBg: {
    backgroundColor: '#10B981',
  },
  studentBtnBg: {
    backgroundColor: '#0284C7',
  },
  pdfBtnBg: {
    backgroundColor: '#4F46E5',
  },
  miniExportText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.white,
  },
  exportAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  exportAllBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.white,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 14,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  filterChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  filterChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: C.textSecondary,
  },
  filterChipTextActive: {
    color: C.white,
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
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rollBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rollBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 11,
    color: C.primary,
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
