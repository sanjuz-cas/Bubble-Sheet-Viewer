import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, ScrollView, Pressable, Platform, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';

import { ScoreRing } from '@/components/ScoreRing';
import { BarChart } from '@/components/BarChart';
import { getScanResults } from '@/lib/storage';
import { getGrade, getGradeColor } from '@/lib/types';
import type { ScanResult } from '@/lib/types';
import { getApiUrl } from '@/lib/query-client';
import { getAuthToken } from '@/lib/auth-token';
import { generateTeacherCSV, generateStudentCSV, downloadCSV } from '@/lib/export-utils';
import Colors from '@/constants/colors';

const C = Colors.light;

function formatAnswers(value: string[] | string): string {
  return Array.isArray(value) ? value.join(' + ') : value;
}

function formatMark(value: number): string {
  return Number(value).toFixed(2).replace(/\.?0+$/, '');
}

export default function ScanResultScreen() {
  const insets = useSafeAreaInsets();
  const { resultId } = useLocalSearchParams<{ resultId: string }>();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);

  useEffect(() => {
    getScanResults().then(results => {
      const r = results.find(x => x.id === resultId);
      if (r) setResult(r);
    });
  }, [resultId]);

  if (!result) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.loadingText}>Loading evaluation...</Text>
      </View>
    );
  }

  const grade = getGrade(result.percentage);
  const correctCount = result.questionResults.filter(q => q.isCorrect).length;
  const partialCount = result.questionResults.filter(
    q => !q.isCorrect && Number(q.mark) > 0
  ).length;
  const incorrectCount = result.questionResults.filter(
    q => !q.isCorrect && Number(q.mark) === 0 && (Array.isArray(q.selected) ? q.selected.length > 0 : !!q.selected)
  ).length;
  const unanswered = result.questionResults.filter(
    q => Array.isArray(q.selected) ? q.selected.length === 0 : !q.selected
  ).length;

  const answerDistribution = result.questionResults.reduce((acc, q) => {
    const selected = formatAnswers(q.selected);
    if (selected) {
      acc[selected] = (acc[selected] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const distData = Object.entries(answerDistribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  const exportStudentCSV = async () => {
    if (!result) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const csvData = generateStudentCSV([result], `${result.answerKeyName} - Roll ${result.detectedRollNumber || 'N/A'}`);
    const safeRoll = (result.detectedRollNumber || 'result').replace(/[^a-zA-Z0-9_-]/g, '_');
    await downloadCSV(csvData, `student_scorecard_${safeRoll}.csv`);
  };

  const exportTeacherCSV = async () => {
    if (!result) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const csvData = generateTeacherCSV([result], `${result.answerKeyName} - Roll ${result.detectedRollNumber || 'N/A'}`);
    const safeRoll = (result.detectedRollNumber || 'result').replace(/[^a-zA-Z0-9_-]/g, '_');
    await downloadCSV(csvData, `teacher_ledger_${safeRoll}.csv`);
  };

  const exportPDF = async () => {
    if (!result) return;
    setExportingPdf(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const baseUrl = getApiUrl();
      const token = getAuthToken();
      const url = `${baseUrl}api/results/${result.id}/export/pdf${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        const safeRoll = (result.detectedRollNumber || 'student').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileUri = `${FileSystem.cacheDirectory}student_report_${safeRoll}.pdf`;
        const downloadRes = await FileSystem.downloadAsync(url, fileUri, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(downloadRes.uri, {
            mimeType: 'application/pdf',
            dialogTitle: 'Student Scorecard PDF Report',
          });
        }
      }
    } catch (e: any) {
      Alert.alert('PDF Export Error', e.message || 'Could not generate student PDF.');
    } finally {
      setExportingPdf(false);
    }
  };

  const exportExcel = async () => {
    if (!result) return;
    setExporting(true);
    try {
      const url = `${getApiUrl()}api/results/${result.id}/export`;
      const token = getAuthToken();

      if (Platform.OS === 'web') {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) { Alert.alert('Export failed', 'Could not generate the file.'); return; }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `bubblescan_${result.answerKeyName.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      } else {
        const downloadUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url;
        await Linking.openURL(downloadUrl);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e.message || 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopInset }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Scan Result</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={exportPDF} disabled={exportingPdf} hitSlop={12}>
            {exportingPdf
              ? <ActivityIndicator size="small" color={C.primary} />
              : <Ionicons name="document-text" size={22} color={C.primary} />
            }
          </Pressable>
          <Pressable onPress={exportExcel} disabled={exporting} hitSlop={12}>
            {exporting
              ? <ActivityIndicator size="small" color={C.primary} />
              : <Ionicons name="share-outline" size={24} color={C.text} />
            }
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[getGradeColor(grade), C.primaryLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.scoreCard}
        >
          <View style={styles.scoreCardInner}>
            <ScoreRing percentage={result.percentage} size={130} color={C.white} label="Score" />
            <View style={styles.scoreInfo}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>{grade}</Text>
              </View>
              <Text style={styles.scoreFraction}>
                {formatMark(result.score)} / {formatMark(result.totalMarks)}
              </Text>
              <Text style={styles.scoreKeyName}>{result.answerKeyName}</Text>
              <Text style={styles.scoreSubject}>{result.subject}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.identityCard}>
          <View style={styles.identityItem}>
            <Ionicons name="person-circle-outline" size={22} color={C.primary} />
            <View>
              <Text style={styles.identityLabel}>Roll Number</Text>
              <Text style={styles.identityValue}>
                {result.detectedRollNumber || 'Not detected'}
              </Text>
            </View>
          </View>
          <View style={styles.identityDivider} />
          <View style={styles.identityItem}>
            <Ionicons name="layers-outline" size={22} color={C.secondary} />
            <View>
              <Text style={styles.identityLabel}>Set</Text>
              <Text style={styles.identityValue}>
                {result.detectedSet || 'Not detected'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Action Export Buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.pdfBtn, pressed && styles.pressed]}
            onPress={exportPDF}
            disabled={exportingPdf}
          >
            <Ionicons name="document-attach-outline" size={16} color={C.white} />
            <Text style={styles.actionBtnText}>Student PDF</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.studentCsvBtn, pressed && styles.pressed]}
            onPress={exportStudentCSV}
          >
            <Ionicons name="school-outline" size={16} color={C.white} />
            <Text style={styles.actionBtnText}>Scorecard CSV</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.teacherCsvBtn, pressed && styles.pressed]}
            onPress={exportTeacherCSV}
          >
            <Ionicons name="analytics-outline" size={16} color={C.white} />
            <Text style={styles.actionBtnText}>Teacher CSV</Text>
          </Pressable>
        </View>

        {/* Visual Graded OMR Preview Card */}
        {result.annotatedImage || result.imageUri ? (
          <View style={styles.section}>
            <Pressable
              style={styles.imageHeaderRow}
              onPress={() => setShowImagePreview(!showImagePreview)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="image-outline" size={20} color={C.primary} />
                <Text style={styles.sectionTitle}>Visual Graded OMR Sheet</Text>
              </View>
              <Ionicons
                name={showImagePreview ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={C.textSecondary}
              />
            </Pressable>
            {showImagePreview ? (
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: result.annotatedImage || result.imageUri }}
                  style={styles.annotatedImg}
                  contentFit="contain"
                />
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: '#0F2210' }]}>
            <Ionicons name="checkmark-circle" size={20} color={C.success} />
            <Text style={styles.statValue}>{correctCount}</Text>
            <Text style={styles.statLabel}>Correct</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: '#0D232C' }]}>
            <Ionicons name="git-commit-outline" size={20} color="#00B4D8" />
            <Text style={styles.statValue}>{partialCount}</Text>
            <Text style={styles.statLabel}>Partial</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: '#220F0F' }]}>
            <Ionicons name="close-circle" size={20} color={C.error} />
            <Text style={styles.statValue}>{incorrectCount}</Text>
            <Text style={styles.statLabel}>Wrong</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: '#221A0A' }]}>
            <Ionicons name="remove-circle" size={20} color={C.warning} />
            <Text style={styles.statValue}>{unanswered}</Text>
            <Text style={styles.statLabel}>Blank</Text>
          </View>
        </View>

        {distData.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Answer Distribution</Text>
            <View style={styles.card}>
              <BarChart data={distData} height={100} />
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Question Details</Text>
          <View style={styles.detailGrid}>
            {result.questionResults.map((q) => {
              const isPartial = !q.isCorrect && q.mark > 0;
              const isBlank = !formatAnswers(q.selected);
              const maxQMarks = q.maxMarks || 3.0;

              return (
                <View
                  key={q.questionNumber}
                  style={[
                    styles.detailItem,
                    {
                      backgroundColor: q.isCorrect
                        ? '#0F2210'
                        : isPartial
                          ? '#0D232C'
                          : isBlank
                            ? '#221A0A'
                            : '#220F0F',
                      borderColor: q.isCorrect
                        ? '#1E4A20'
                        : isPartial
                          ? '#1A4D63'
                          : isBlank
                            ? '#3A2A10'
                            : '#4A1A1A',
                    },
                  ]}
                >
                  <Text style={styles.detailNum}>Q{q.questionNumber}</Text>
                  <View style={styles.detailRow}>
                    <View style={[
                      styles.detailBubble,
                      {
                        backgroundColor: q.isCorrect
                          ? C.success
                          : isPartial
                            ? '#00B4D8'
                            : isBlank
                              ? C.warning
                              : C.error,
                      },
                    ]}>
                      <Text style={styles.detailBubbleText}>
                        {formatAnswers(q.selected) || '-'}
                      </Text>
                    </View>
                    {!q.isCorrect ? (
                      <View style={[styles.detailBubble, { backgroundColor: C.success }]}>
                        <Text style={styles.detailBubbleText}>{formatAnswers(q.correct)}</Text>
                      </View>
                    ) : null}
                  </View>
                  {q.isCorrect ? (
                    <Ionicons name="checkmark" size={14} color={C.success} />
                  ) : isPartial ? (
                    <Ionicons name="git-commit-outline" size={14} color="#00B4D8" />
                  ) : (
                    <Ionicons name="close" size={14} color={C.error} />
                  )}
                  <Text style={styles.questionMark}>
                    {formatMark(Number.isFinite(q.mark) ? q.mark : 0)} / {formatMark(maxQMarks)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={styles.dateText}>
          Scanned {new Date(result.scannedAt).toLocaleString()}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 16,
    color: C.textSecondary,
  },
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
  scoreCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  scoreCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  scoreInfo: { flex: 1 },
  gradeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 8,
  },
  gradeBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: C.white,
  },
  scoreFraction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 22,
    color: C.white,
    marginBottom: 4,
  },
  scoreKeyName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  scoreSubject: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  identityItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.cardBorder,
    marginHorizontal: 12,
  },
  identityLabel: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: C.textSecondary,
  },
  identityValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: C.text,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  pdfBtn: { backgroundColor: '#4F46E5' },
  studentCsvBtn: { backgroundColor: '#0284C7' },
  teacherCsvBtn: { backgroundColor: '#10B981' },
  actionBtnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.white,
  },
  imageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 8,
  },
  imageContainer: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: C.cardBorder,
    alignItems: 'center',
    marginBottom: 14,
  },
  annotatedImg: {
    width: '100%',
    height: 380,
    borderRadius: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  statValue: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: C.text,
    marginTop: 4,
  },
  statLabel: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 2,
  },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 10,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailItem: {
    width: '48.5%',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailNum: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 4,
  },
  detailBubble: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  detailBubbleText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.white,
  },
  questionMark: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.text,
  },
  dateText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: C.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  pressed: { opacity: 0.75 },
});
