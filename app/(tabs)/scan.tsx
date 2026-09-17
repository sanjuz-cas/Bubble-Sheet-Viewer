import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, ScrollView, Pressable, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { getApiUrl } from '@/lib/query-client';
import { getAuthToken } from '@/lib/auth-token';
import { getAnswerKeys, saveScanResult } from '@/lib/storage';
import { calculateQuestionMark } from '@/lib/types';
import type { AnswerKey, ScanResult, QuestionResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { sortResultsByRollNumber, generateTeacherCSV, generateStudentCSV, generateRollWiseCSV, downloadCSV } from '@/lib/export-utils';
import { getGrade, getGradeColor } from '@/lib/types';

function formatMark(value: number): string {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<AnswerKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<AnswerKey | null>(null);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [liveStatusText, setLiveStatusText] = useState<string>('');
  const [batchResults, setBatchResults] = useState<ScanResult[]>([]);
  const [batchSummary, setBatchSummary] = useState<{ completed: number; failed: number } | null>(null);

  const loadKeys = useCallback(async () => {
    const k = await getAnswerKeys();
    setKeys(k);
    if (k.length > 0 && !selectedKey) {
      setSelectedKey(k[0]);
    }
  }, [selectedKey]);

  useFocusEffect(
    useCallback(() => {
      loadKeys();
    }, [])
  );

  const pickImage = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission needed', 'Camera access is required to scan answer sheets.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.8,
          allowsEditing: false,
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          selectionLimit: 100,
        });
      }

      if (!result.canceled && result.assets.length > 0) {
        setImageUris(prev => {
          const next = [...prev, ...result.assets.map(asset => asset.uri)];
          return Array.from(new Set(next)).slice(0, 100);
        });
        setBatchSummary(null);
        setBatchResults([]);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const processSingleImage = async (imageUri: string, answerKey: AnswerKey): Promise<ScanResult> => {
      const formData = new FormData();

      let ext = 'jpg';
      if (imageUri.startsWith('data:image/png') || imageUri.includes('.png')) {
        ext = 'png';
      }

      if (Platform.OS === 'web') {
        const response = await fetch(imageUri);
        const blob = await response.blob();
        formData.append('image', blob, `scan.${ext}`);
      } else {
        formData.append('image', {
          uri: imageUri,
          name: `scan.${ext}`,
          type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
        } as any);
      }

      formData.append('totalQuestions', String(answerKey.totalQuestions));
      formData.append('optionsPerQuestion', String(answerKey.optionsPerQuestion));
      formData.append('correctAnswers', JSON.stringify(answerKey.answers));

      const baseUrl = getApiUrl();
      const token = getAuthToken();
      const res = await fetch(`${baseUrl}api/scan`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Scan failed');
      }

      const data = await res.json();
      const detectedAnswers: string[][] = (data.detectedAnswers || []).map(
        (answer: string[] | string) => Array.isArray(answer) ? answer : answer ? [answer] : []
      );
      const detectedSet: string = data.detectedSet || '';
      const detectedRollNumber: string = data.detectedRollNumber || '';
      const annotatedImage: string | undefined = data.annotatedImage || undefined;

      let matchedSetAnswers: string[][] | undefined;
      if (answerKey.setAnswers) {
        if (detectedSet && answerKey.setAnswers[detectedSet]?.length) {
          matchedSetAnswers = answerKey.setAnswers[detectedSet];
        } else if (detectedSet) {
          const cleanDetected = detectedSet.toUpperCase().replace(/\s+/g, '');
          const matchedKey = Object.keys(answerKey.setAnswers).find(
            (k) => k.toUpperCase().replace(/\s+/g, '') === cleanDetected
          );
          if (matchedKey && answerKey.setAnswers[matchedKey]?.length) {
            matchedSetAnswers = answerKey.setAnswers[matchedKey];
          }
        }
      }

      const numQuestions = answerKey.totalQuestions;
      const baseAnswers = matchedSetAnswers || answerKey.answers || [];
      const gradingAnswers = Array.from({ length: numQuestions }, (_, i) => {
        const ans = baseAnswers[i];
        // Only use the answer if it's a non-empty array; never default to 'A'
        return (Array.isArray(ans) && ans.length > 0) ? ans : [];
      });

      const T = Number(answerKey.marksPerQuestion) > 0 ? Number(answerKey.marksPerQuestion) : 3.0;
      const optsCount = answerKey.optionsPerQuestion || 6;

      const questionResults: QuestionResult[] = gradingAnswers.map((correct, i) => {
        const selected = detectedAnswers[i] || [];
        const grading = calculateQuestionMark(correct, selected, T, optsCount);
        return {
          questionNumber: i + 1,
          selected,
          correct,
          isCorrect: grading.isExactMatch,
          mark: grading.mark,
          maxMarks: T,
          baseScore: grading.baseScore,
          penalty: grading.penalty,
          correctSelected: grading.correctSelected,
          wrongSelected: grading.wrongSelected,
          totalSelected: grading.totalSelected,
        };
      });

      const totalMarks = numQuestions * T;
      const score = questionResults.reduce((sum, question) => sum + question.mark, 0);
      const percentage = totalMarks > 0 ? (score / totalMarks) * 100 : 0;

      return {
        id: Crypto.randomUUID(),
        answerKeyId: answerKey.id,
        answerKeyName: answerKey.name,
        subject: answerKey.subject,
        detectedAnswers,
        correctAnswers: gradingAnswers,
        score,
        totalQuestions: answerKey.totalQuestions,
        totalMarks,
        percentage,
        questionResults,
        scannedAt: new Date().toISOString(),
        imageUri,
        annotatedImage,
        detectedSet,
        detectedRollNumber,
      };
  };

  const processImages = async () => {
    if (imageUris.length === 0 || !selectedKey || processing) return;
    const imagesToProcess = imageUris.slice(0, 100);
    const answerKey = selectedKey;
    setProcessing(true);
    setBatchSummary(null);
    setBatchResults([]);
    setProcessingIndex(0);
    setLiveStatusText('Starting evaluation...');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let completed = 0;
    let failed = 0;
    const currentResults: ScanResult[] = [];
    let firstResult: ScanResult | null = null;

    for (let i = 0; i < imagesToProcess.length; i += 1) {
      setProcessingIndex(i + 1);
      setLiveStatusText(`Evaluating Sheet ${i + 1} of ${imagesToProcess.length}...`);
      try {
        const result = await processSingleImage(imagesToProcess[i], answerKey);
        await saveScanResult(result);
        currentResults.push(result);
        if (!firstResult) firstResult = result;
        completed += 1;
        setLiveStatusText(`Sheet ${i + 1}/${imagesToProcess.length}: Roll ${result.detectedRollNumber || 'N/A'} (${result.detectedSet || 'No Set'}) - ${result.score.toFixed(1)}/${result.totalMarks} Marks`);
      } catch (err) {
        failed += 1;
        console.error(`OMR batch item ${i + 1} failed`, err);
      }
    }

    const sorted = sortResultsByRollNumber(currentResults);
    setBatchResults(sorted);
    setProcessing(false);
    setProcessingIndex(0);
    setLiveStatusText('');
    setImageUris([]);
    setBatchSummary({ completed, failed });
    Haptics.notificationAsync(
      failed === 0
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning
    );

    if (imagesToProcess.length === 1 && firstResult) {
      router.push({ pathname: '/scan-result', params: { resultId: firstResult.id } });
    }
  };

  const handleExportTeacherCSV = async () => {
    if (batchResults.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const examName = selectedKey?.name || 'Exam';
    const csvData = generateTeacherCSV(batchResults, `${examName} - Teacher Master Ledger`);
    const fileName = `${examName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Teacher_Master_Ledger.csv`;
    await downloadCSV(csvData, fileName);
  };

  const handleExportStudentCSV = async () => {
    if (batchResults.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const examName = selectedKey?.name || 'Exam';
    const csvData = generateStudentCSV(batchResults, `${examName} - Student Scorecards`);
    const fileName = `${examName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Student_Scorecards.csv`;
    await downloadCSV(csvData, fileName);
  };

  const handleExportPDFDossier = async () => {
    if (batchResults.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const baseUrl = getApiUrl();
      const token = getAuthToken();
      const ids = batchResults.map(r => r.id).join(',');
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

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16 + webTopInset, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Scan Sheet</Text>
        <Text style={styles.subtitle}>Capture an answer sheet to grade it</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Answer Key</Text>
          {keys.length === 0 ? (
            <Pressable
              style={({ pressed }) => [styles.emptyKeyCard, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/keys')}
            >
              <Ionicons name="add-circle" size={28} color={C.primary} />
              <Text style={styles.emptyKeyText}>Create your first answer key</Text>
            </Pressable>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keyList}>
              {keys.map(k => (
                <Pressable
                  key={k.id}
                  style={[
                    styles.keyChip,
                    selectedKey?.id === k.id && styles.keyChipActive,
                  ]}
                  onPress={() => {
                    setSelectedKey(k);
                    Haptics.selectionAsync();
                  }}
                >
                  <Ionicons
                    name="key"
                    size={14}
                    color={selectedKey?.id === k.id ? C.white : C.primary}
                  />
                  <Text style={[
                    styles.keyChipText,
                    selectedKey?.id === k.id && styles.keyChipTextActive,
                  ]}>
                    {k.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Capture Images</Text>
            {imageUris.length > 0 ? (
              <Pressable onPress={() => {
                if (!processing) {
                  setImageUris([]);
                  setBatchSummary(null);
                }
              }} disabled={processing}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {imageUris.length > 0 ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: imageUris[0] }} style={styles.previewImage} contentFit="contain" />
              <View style={styles.imageCountBadge}>
                <Ionicons name="images-outline" size={16} color={C.white} />
                <Text style={styles.imageCountText}>
                  {imageUris.length} {imageUris.length === 1 ? 'sheet' : 'sheets'} selected
                </Text>
              </View>
              <Pressable
                style={styles.removeImageBtn}
                onPress={() => setImageUris(prev => prev.slice(1))}
                disabled={processing}
              >
                <Ionicons name="close-circle" size={32} color={C.error} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.captureButtons}>
              <Pressable
                style={({ pressed }) => [styles.captureBtn, pressed && styles.pressed]}
                onPress={() => pickImage(true)}
              >
                <LinearGradient
                  colors={[C.primary, C.primaryDark]}
                  style={styles.captureBtnGradient}
                >
                  <Ionicons name="camera" size={36} color={C.white} />
                  <Text style={styles.captureBtnText}>Camera</Text>
                </LinearGradient>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.captureBtn, pressed && styles.pressed]}
                onPress={() => pickImage(false)}
              >
                <LinearGradient
                  colors={[C.secondary, C.primaryDark]}
                  style={styles.captureBtnGradient}
                >
                  <Ionicons name="images" size={36} color={C.white} />
                  <Text style={styles.captureBtnText}>Gallery (up to 100)</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </View>

        {!selectedKey && imageUris.length > 0 ? (
          <View style={[styles.infoCard, { borderColor: C.warning, borderWidth: 1 }]}>
            <Ionicons name="warning-outline" size={20} color={C.warning} />
            <View style={styles.infoContent}>
              <Text style={[styles.infoTitle, { color: C.warning }]}>No Answer Key Selected</Text>
              <Text style={styles.infoText}>
                Please select or create an Answer Key above to start grading your {imageUris.length} selected sheet{imageUris.length > 1 ? 's' : ''}.
              </Text>
            </View>
          </View>
        ) : null}

        {selectedKey && imageUris.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <Pressable
              style={({ pressed }) => [
                styles.scanButton,
                pressed && styles.pressed,
                processing && styles.scanButtonDisabled,
              ]}
              onPress={processImages}
              disabled={processing}
            >
              {processing ? (
                <View style={styles.processingRow}>
                  <ActivityIndicator color={C.white} />
                  <Text style={styles.scanButtonText}>
                    Processing {processingIndex} of {imageUris.length}...
                  </Text>
                </View>
              ) : (
                <View style={styles.processingRow}>
                  <Ionicons name="scan" size={22} color={C.white} />
                  <Text style={styles.scanButtonText}>
                    {imageUris.length > 1 ? `Evaluate ${imageUris.length} Sheets (Bulk)` : 'Scan & Grade Sheet'}
                  </Text>
                </View>
              )}
            </Pressable>
            {processing && liveStatusText ? (
              <Text style={styles.liveStatusText}>{liveStatusText}</Text>
            ) : null}
          </View>
        ) : null}

        {batchResults.length > 0 ? (
          <View style={styles.batchSection}>
            <View style={styles.batchHeaderCard}>
              <View style={styles.batchHeaderLeft}>
                <Ionicons name="documents" size={26} color={C.primary} />
                <View>
                  <Text style={styles.batchTitle}>Bulk Evaluation Complete</Text>
                  <Text style={styles.batchSubtitle}>
                    {batchResults.length} {batchResults.length === 1 ? 'sheet' : 'sheets'} evaluated · Sorted Roll-Number-Wise
                  </Text>
                </View>
              </View>
            </View>

            {/* Tri-Export Action Suite */}
            <View style={styles.batchActionsRow}>
              <Pressable
                style={({ pressed }) => [styles.batchActionBtn, styles.teacherBtnBg, pressed && styles.pressed]}
                onPress={handleExportTeacherCSV}
              >
                <Ionicons name="analytics-outline" size={16} color={C.white} />
                <Text style={styles.batchActionBtnText}>Teacher CSV</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.batchActionBtn, styles.studentBtnBg, pressed && styles.pressed]}
                onPress={handleExportStudentCSV}
              >
                <Ionicons name="school-outline" size={16} color={C.white} />
                <Text style={styles.batchActionBtnText}>Student CSV</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.batchActionBtn, styles.pdfBtnBg, pressed && styles.pressed]}
                onPress={handleExportPDFDossier}
              >
                <Ionicons name="document-text-outline" size={16} color={C.white} />
                <Text style={styles.batchActionBtnText}>PDF Dossier</Text>
              </Pressable>
            </View>

            <Text style={styles.rosterSectionTitle}>Roll Number Roster ({batchResults.length})</Text>
            <View style={styles.rosterCard}>
              <View style={styles.rosterHeaderRow}>
                <Text style={[styles.rosterHeaderCell, { width: 45 }]}>#</Text>
                <Text style={[styles.rosterHeaderCell, { flex: 1.2 }]}>Roll No.</Text>
                <Text style={[styles.rosterHeaderCell, { flex: 0.9 }]}>Set</Text>
                <Text style={[styles.rosterHeaderCell, { flex: 1.3, textAlign: 'right' }]}>Score</Text>
                <Text style={[styles.rosterHeaderCell, { width: 50, textAlign: 'center' }]}>Grade</Text>
              </View>
              {batchResults.map((item, idx) => {
                const grade = getGrade(item.percentage);
                return (
                  <Pressable
                    key={item.id || idx}
                    style={({ pressed }) => [
                      styles.rosterRow,
                      idx % 2 === 1 && styles.rosterRowAlt,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => router.push({ pathname: '/scan-result', params: { resultId: item.id } })}
                  >
                    <Text style={[styles.rosterCellText, { width: 45, color: C.textLight }]}>{idx + 1}</Text>
                    <Text style={[styles.rosterCellBold, { flex: 1.2 }]}>
                      {item.detectedRollNumber || '—'}
                    </Text>
                    <View style={{ flex: 0.9 }}>
                      <View style={styles.setChipMini}>
                        <Text style={styles.setChipMiniText}>{item.detectedSet || 'N/A'}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1.3, alignItems: 'flex-end' }}>
                      <Text style={styles.rosterScoreText}>
                        {formatMark(item.score)}/{formatMark(item.totalMarks)}
                      </Text>
                      <Text style={styles.rosterPercentText}>{Math.round(item.percentage)}%</Text>
                    </View>
                    <View style={{ width: 50, alignItems: 'center' }}>
                      <View style={[styles.gradeBadgeMini, { backgroundColor: getGradeColor(grade) }]}>
                        <Text style={styles.gradeBadgeMiniText}>{grade}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={({ pressed }) => [styles.exportHistoryBtn, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/history')}
            >
              <Ionicons name="time-outline" size={18} color={C.primary} />
              <Text style={styles.exportHistoryBtnText}>View All in History</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedKey && !batchResults.length ? (
          <View style={[styles.infoCard, { marginTop: 20 }]}>
            <Ionicons name="information-circle" size={20} color={C.secondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Selected: {selectedKey.name}</Text>
              <Text style={styles.infoText}>
                 {selectedKey.totalQuestions} questions · {selectedKey.optionsPerQuestion} options each
                 {' · '}{selectedKey.marksPerQuestion} mark{selectedKey.marksPerQuestion === 1 ? '' : 's'} each
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 20 },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 28,
    color: C.text,
  },
  subtitle: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
    marginBottom: 24,
  },
  section: { marginBottom: 24 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 0,
  },
  clearText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: C.error,
  },
  keyList: { gap: 10 },
  keyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
  },
  keyChipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  keyChipText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: C.primary,
  },
  keyChipTextActive: { color: C.white },
  emptyKeyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    borderStyle: 'dashed',
  },
  emptyKeyText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: C.text,
  },
  captureButtons: {
    flexDirection: 'row',
    gap: 14,
  },
  captureBtn: {
    flex: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  captureBtnGradient: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 10,
    borderRadius: 20,
  },
  captureBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.white,
  },
  previewContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  previewImage: {
    width: '100%',
    height: 280,
    borderRadius: 20,
  },
  removeImageBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  imageCountBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 17, 24, 0.82)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  imageCountText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.white,
  },
  scanButton: {
    backgroundColor: C.primary,
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  scanButtonDisabled: { opacity: 0.7 },
  scanButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 17,
    color: C.white,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.sky,
    borderRadius: 14,
    padding: 14,
  },
  batchSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    padding: 14,
    marginTop: 20,
  },
  viewHistoryText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.primary,
  },
  infoContent: { flex: 1 },
  infoTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: C.text,
  },
  infoText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  liveStatusText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: C.primary,
    textAlign: 'center',
    marginTop: 8,
  },
  batchSection: {
    marginTop: 20,
  },
  batchHeaderCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.primary,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  batchHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  batchTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: C.text,
  },
  batchSubtitle: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  batchActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  batchActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
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
  batchActionBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.white,
  },
  csvDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  csvBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: C.white,
  },
  rosterSectionTitle: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    color: C.text,
    marginBottom: 10,
  },
  rosterCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.cardBorder,
    overflow: 'hidden',
    marginBottom: 16,
  },
  rosterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.sky,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  rosterHeaderCell: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.textSecondary,
    textTransform: 'uppercase',
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  rosterRowAlt: {
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
  },
  rosterCellText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: C.text,
  },
  rosterCellBold: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 14,
    color: C.primary,
  },
  setChipMini: {
    backgroundColor: C.sky,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  setChipMiniText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.primary,
  },
  rosterScoreText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 13,
    color: C.text,
  },
  rosterPercentText: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 11,
    color: C.textSecondary,
  },
  gradeBadgeMini: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  gradeBadgeMiniText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 12,
    color: '#1E1B2E',
  },
  exportHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.cardBorder,
    borderRadius: 14,
    paddingVertical: 14,
  },
  exportHistoryBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
    color: C.primary,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
