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
import type { AnswerKey, ScanResult, QuestionResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<AnswerKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<AnswerKey | null>(null);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [batchSummary, setBatchSummary] = useState<{ completed: number; failed: number } | null>(null);

  useFocusEffect(useCallback(() => {
    getAnswerKeys().then(k => {
      setKeys(k);
      if (k.length > 0 && !selectedKey) setSelectedKey(k[0]);
    });
  }, []));

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
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const processSingleImage = async (imageUri: string, answerKey: AnswerKey): Promise<ScanResult> => {
      const formData = new FormData();

      const uriParts = imageUri.split('.');
      const ext = uriParts[uriParts.length - 1] || 'jpg';
      formData.append('image', {
        uri: imageUri,
        name: `scan.${ext}`,
        type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
      } as any);

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
      const detectedAnswers: string[] = data.detectedAnswers;
      const detectedSet: string = data.detectedSet || '';
      const detectedRollNumber: string = data.detectedRollNumber || '';
      const gradingAnswers = answerKey.setAnswers?.[detectedSet] || answerKey.answers;

      if (answerKey.setAnswers && !answerKey.setAnswers[detectedSet]) {
        throw new Error(
          `${detectedSet || 'A set'} has no answer key configured. Complete all six set tabs first.`
        );
      }

      const questionResults: QuestionResult[] = gradingAnswers.map((correct, i) => ({
        questionNumber: i + 1,
        selected: detectedAnswers[i] || '',
        correct,
        isCorrect: detectedAnswers[i] === correct,
      }));

      const score = questionResults.filter(q => q.isCorrect).length;
      const percentage = (score / answerKey.totalQuestions) * 100;

      return {
        id: Crypto.randomUUID(),
        answerKeyId: answerKey.id,
        answerKeyName: answerKey.name,
        subject: answerKey.subject,
        detectedAnswers,
        correctAnswers: gradingAnswers,
        score,
        totalQuestions: answerKey.totalQuestions,
        percentage,
        questionResults,
        scannedAt: new Date().toISOString(),
        imageUri,
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
    setProcessingIndex(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    let completed = 0;
    let failed = 0;
    let firstResult: ScanResult | null = null;

    for (let i = 0; i < imagesToProcess.length; i += 1) {
      setProcessingIndex(i + 1);
      try {
        const result = await processSingleImage(imagesToProcess[i], answerKey);
        await saveScanResult(result);
        if (!firstResult) firstResult = result;
        completed += 1;
      } catch (err) {
        failed += 1;
        console.error(`OMR batch item ${i + 1} failed`, err);
      }
    }

    setProcessing(false);
    setProcessingIndex(0);
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

        {selectedKey && imageUris.length > 0 ? (
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
                  {imageUris.length > 1 ? `Process ${imageUris.length} Sheets` : 'Scan & Grade'}
                </Text>
              </View>
            )}
          </Pressable>
        ) : null}

        {batchSummary ? (
          <View style={styles.batchSummaryCard}>
            <Ionicons
              name={batchSummary.failed === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={24}
              color={batchSummary.failed === 0 ? C.success : C.warning}
            />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Batch processing complete</Text>
              <Text style={styles.infoText}>
                {batchSummary.completed} saved
                {batchSummary.failed > 0 ? ` · ${batchSummary.failed} failed` : ''}
              </Text>
            </View>
            <Pressable onPress={() => router.push('/(tabs)/history')}>
              <Text style={styles.viewHistoryText}>View history</Text>
            </Pressable>
          </View>
        ) : null}

        {selectedKey ? (
          <View style={[styles.infoCard, { marginTop: 20 }]}>
            <Ionicons name="information-circle" size={20} color={C.secondary} />
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Selected: {selectedKey.name}</Text>
              <Text style={styles.infoText}>
                {selectedKey.totalQuestions} questions  {selectedKey.optionsPerQuestion} options each
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
    fontFamily: 'Nunito_500Medium',
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
