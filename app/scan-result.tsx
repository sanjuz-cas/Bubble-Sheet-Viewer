import React, { useEffect, useState } from 'react';
import {
  StyleSheet, Text, View, ScrollView, Pressable, Platform, Alert, ActivityIndicator, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { ScoreRing } from '@/components/ScoreRing';
import { BarChart } from '@/components/BarChart';
import { getScanResults } from '@/lib/storage';
import { getGrade, getGradeColor } from '@/lib/types';
import type { ScanResult } from '@/lib/types';
import { getApiUrl } from '@/lib/query-client';
import { getAuthToken } from '@/lib/auth-token';
import Colors from '@/constants/colors';

const C = Colors.light;

function formatCorrectAnswer(correct: string[] | string): string {
  return Array.isArray(correct) ? correct.join(' or ') : correct;
}

export default function ScanResultScreen() {
  const insets = useSafeAreaInsets();
  const { resultId } = useLocalSearchParams<{ resultId: string }>();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getScanResults().then(results => {
      const r = results.find(x => x.id === resultId);
      if (r) setResult(r);
    });
  }, [resultId]);

  if (!result) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const grade = getGrade(result.percentage);
  const correctCount = result.questionResults.filter(q => q.isCorrect).length;
  const incorrectCount = result.questionResults.filter(q => !q.isCorrect && q.selected).length;
  const unanswered = result.questionResults.filter(q => !q.selected).length;

  const answerDistribution = result.questionResults.reduce((acc, q) => {
    if (q.selected) {
      acc[q.selected] = (acc[q.selected] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const distData = Object.entries(answerDistribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, value]) => ({ label, value }));
  const webTopInset = Platform.OS === 'web' ? 67 : 0;

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
        <Pressable onPress={exportExcel} disabled={exporting} hitSlop={12}>
          {exporting
            ? <ActivityIndicator size="small" color={C.primary} />
            : <Ionicons name="share-outline" size={24} color={C.text} />
          }
        </Pressable>
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
              <Text style={styles.scoreFraction}>{result.score} / {result.totalQuestions}</Text>
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

        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: '#0F2210' }]}>
            <Ionicons name="checkmark-circle" size={20} color={C.success} />
            <Text style={styles.statValue}>{correctCount}</Text>
            <Text style={styles.statLabel}>Correct</Text>
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
            {result.questionResults.map((q) => (
              <View
                key={q.questionNumber}
                style={[
                  styles.detailItem,
                  {
                    backgroundColor: q.isCorrect ? '#0F2210' : !q.selected ? '#221A0A' : '#220F0F',
                    borderColor: q.isCorrect ? '#1E4A20' : !q.selected ? '#3A2A10' : '#4A1A1A',
                  },
                ]}
              >
                <Text style={styles.detailNum}>Q{q.questionNumber}</Text>
                <View style={styles.detailRow}>
                  <View style={[
                    styles.detailBubble,
                    {
                      backgroundColor: q.isCorrect ? C.success : !q.selected ? C.warning : C.error,
                    },
                  ]}>
                    <Text style={styles.detailBubbleText}>
                      {q.selected || '-'}
                    </Text>
                  </View>
                  {!q.isCorrect ? (
                    <View style={[styles.detailBubble, { backgroundColor: C.success }]}>
                      <Text style={styles.detailBubbleText}>{formatCorrectAnswer(q.correct)}</Text>
                    </View>
                  ) : null}
                </View>
                {q.isCorrect ? (
                  <Ionicons name="checkmark" size={14} color={C.success} />
                ) : (
                  <Ionicons name="close" size={14} color={C.error} />
                )}
              </View>
            ))}
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
    padding: 24,
    marginBottom: 20,
  },
  scoreCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  scoreInfo: {
    flex: 1,
    alignItems: 'flex-start',
    gap: 6,
  },
  gradeBadge: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  gradeBadgeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 24,
    color: C.white,
  },
  scoreFraction: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 18,
    color: C.white,
  },
  scoreKeyName: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
  },
  scoreSubject: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.cardBorder,
    padding: 16,
    marginBottom: 20,
  },
  identityItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  identityDivider: {
    width: 1,
    height: 34,
    backgroundColor: C.cardBorder,
    marginHorizontal: 12,
  },
  identityLabel: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 11,
    color: C.textSecondary,
  },
  identityValue: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: C.text,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 22,
    color: C.text,
  },
  statLabel: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 11,
    color: C.textSecondary,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailItem: {
    width: '23%',
    minWidth: 72,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    gap: 4,
  },
  detailNum: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 11,
    color: C.textSecondary,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  detailBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBubbleText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 12,
    color: C.white,
  },
  dateText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: C.textLight,
    textAlign: 'center',
    marginTop: 8,
  },
});
