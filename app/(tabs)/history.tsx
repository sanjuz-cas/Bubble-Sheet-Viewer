import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, Pressable, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { getScanResults, deleteScanResult } from '@/lib/storage';
import { getGrade, getGradeColor } from '@/lib/types';
import { PieChart } from '@/components/PieChart';
import type { ScanResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

function ResultCard({ item, onDelete }: { item: ScanResult; onDelete: () => void }) {
  const grade = getGrade(item.percentage);
  const dateStr = new Date(item.scannedAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <Pressable
      style={({ pressed }) => [styles.resultCard, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/scan-result', params: { resultId: item.id } })}
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
      </View>
    </Pressable>
  );
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const [results, setResults] = useState<ScanResult[]>([]);

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
          <ResultCard item={item} onDelete={() => handleDelete(item.id)} />
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
    backgroundColor: C.white,
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
    backgroundColor: C.white,
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
});
