import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, ScrollView, Pressable, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ScoreRing } from '@/components/ScoreRing';
import { BarChart } from '@/components/BarChart';
import { getAnswerKeys, getScanResults } from '@/lib/storage';
import { getGrade, getGradeColor } from '@/lib/types';
import type { AnswerKey, ScanResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<AnswerKey[]>([]);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [k, r] = await Promise.all([getAnswerKeys(), getScanResults()]);
    setKeys(k);
    setResults(r);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const avgScore = results.length > 0
    ? Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
    : 0;

  const gradeDistribution = results.reduce((acc, r) => {
    const g = getGrade(r.percentage);
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const gradeData = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F']
    .filter(g => gradeDistribution[g])
    .map(g => ({ label: g, value: gradeDistribution[g] || 0, color: getGradeColor(g as any) }));

  const recentResults = results.slice(0, 5);

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16 + webTopInset, paddingBottom: insets.bottom + 100 },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[C.primaryLight, C.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerTextArea}>
              <Text style={styles.greeting}>BubbleScan</Text>
              <Text style={styles.subtitle}>Your adorable OMR grader</Text>
            </View>
            <View style={styles.headerIcon}>
              <Ionicons name="sparkles" size={32} color={C.white} />
            </View>
          </View>
        </LinearGradient>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: C.lavender }]}>
            <Ionicons name="document-text" size={22} color={C.accentDark} />
            <Text style={styles.statValue}>{results.length}</Text>
            <Text style={styles.statLabel}>Scans</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: C.secondaryLight }]}>
            <Ionicons name="key" size={22} color="#6BBF8A" />
            <Text style={styles.statValue}>{keys.length}</Text>
            <Text style={styles.statLabel}>Keys</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#FFE8D6' }]}>
            <Ionicons name="star" size={22} color="#E5A06B" />
            <Text style={styles.statValue}>{avgScore}%</Text>
            <Text style={styles.statLabel}>Avg</Text>
          </View>
        </View>

        {results.length > 0 ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Average Score</Text>
              <View style={styles.card}>
                <View style={styles.scoreCenter}>
                  <ScoreRing percentage={avgScore} size={140} label="Overall" />
                  <View style={styles.gradeTag}>
                    <Text style={styles.gradeText}>{getGrade(avgScore)}</Text>
                  </View>
                </View>
              </View>
            </View>

            {gradeData.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Grade Distribution</Text>
                <View style={styles.card}>
                  <BarChart data={gradeData} height={120} />
                </View>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Scans</Text>
              {recentResults.map((r) => {
                const grade = getGrade(r.percentage);
                return (
                  <Pressable
                    key={r.id}
                    style={({ pressed }) => [styles.resultItem, pressed && styles.pressed]}
                    onPress={() => router.push({ pathname: '/scan-result', params: { resultId: r.id } })}
                  >
                    <View style={[styles.resultGradeDot, { backgroundColor: getGradeColor(grade) }]}>
                      <Text style={styles.resultGradeText}>{grade}</Text>
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{r.answerKeyName}</Text>
                      <Text style={styles.resultSubject}>{r.subject}</Text>
                    </View>
                    <View style={styles.resultScore}>
                      <Text style={styles.resultScoreText}>{r.score}/{r.totalQuestions}</Text>
                      <Text style={styles.resultPercentage}>{Math.round(r.percentage)}%</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="scan-outline" size={64} color={C.primaryLight} />
            <Text style={styles.emptyTitle}>No scans yet</Text>
            <Text style={styles.emptySubtitle}>Create an answer key and start scanning</Text>
            <Pressable
              style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/scan')}
            >
              <Ionicons name="camera" size={20} color={C.white} />
              <Text style={styles.startButtonText}>Start Scanning</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 20 },
  headerGradient: {
    borderRadius: 24,
    marginBottom: 20,
    overflow: 'hidden',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
  },
  headerTextArea: { flex: 1 },
  greeting: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 26,
    color: C.white,
  },
  subtitle: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 22,
    color: C.text,
  },
  statLabel: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.textSecondary,
  },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 18,
    color: C.text,
    marginBottom: 12,
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: C.cardBorder,
  },
  scoreCenter: {
    alignItems: 'center',
    gap: 12,
  },
  gradeTag: {
    backgroundColor: C.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 12,
  },
  gradeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 18,
    color: C.white,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.cardBorder,
    gap: 12,
  },
  resultGradeDot: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultGradeText: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 14,
    color: C.white,
  },
  resultInfo: { flex: 1 },
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
  resultScore: { alignItems: 'flex-end' },
  resultScoreText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 15,
    color: C.text,
  },
  resultPercentage: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.textSecondary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
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
  },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    marginTop: 8,
  },
  startButtonText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.white,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
