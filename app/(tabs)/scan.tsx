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
import { getAnswerKeys, saveScanResult } from '@/lib/storage';
import type { AnswerKey, ScanResult, QuestionResult } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<AnswerKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<AnswerKey | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

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
        });
      }

      if (!result.canceled && result.assets[0]) {
        setImageUri(result.assets[0].uri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const processImage = async () => {
    if (!imageUri || !selectedKey) return;
    setProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const formData = new FormData();

      const uriParts = imageUri.split('.');
      const ext = uriParts[uriParts.length - 1] || 'jpg';
      formData.append('image', {
        uri: imageUri,
        name: `scan.${ext}`,
        type: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
      } as any);

      formData.append('totalQuestions', String(selectedKey.totalQuestions));
      formData.append('optionsPerQuestion', String(selectedKey.optionsPerQuestion));
      formData.append('correctAnswers', JSON.stringify(selectedKey.answers));

      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}api/scan`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Scan failed');
      }

      const data = await res.json();
      const detectedAnswers: string[] = data.detectedAnswers;

      const questionResults: QuestionResult[] = selectedKey.answers.map((correct, i) => ({
        questionNumber: i + 1,
        selected: detectedAnswers[i] || '',
        correct,
        isCorrect: detectedAnswers[i] === correct,
      }));

      const score = questionResults.filter(q => q.isCorrect).length;
      const percentage = (score / selectedKey.totalQuestions) * 100;

      const scanResult: ScanResult = {
        id: Crypto.randomUUID(),
        answerKeyId: selectedKey.id,
        answerKeyName: selectedKey.name,
        subject: selectedKey.subject,
        detectedAnswers,
        correctAnswers: selectedKey.answers,
        score,
        totalQuestions: selectedKey.totalQuestions,
        percentage,
        questionResults,
        scannedAt: new Date().toISOString(),
        imageUri,
      };

      await saveScanResult(scanResult);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setImageUri(null);
      router.push({ pathname: '/scan-result', params: { resultId: scanResult.id } });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Scan Error', err.message || 'Something went wrong during scanning.');
    } finally {
      setProcessing(false);
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
          <Text style={styles.sectionTitle}>Capture Image</Text>
          {imageUri ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: imageUri }} style={styles.previewImage} contentFit="contain" />
              <Pressable
                style={styles.removeImageBtn}
                onPress={() => setImageUri(null)}
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
                  colors={[C.secondary, '#78D4A8']}
                  style={styles.captureBtnGradient}
                >
                  <Ionicons name="images" size={36} color={C.white} />
                  <Text style={styles.captureBtnText}>Gallery</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </View>

        {selectedKey && imageUri ? (
          <Pressable
            style={({ pressed }) => [
              styles.scanButton,
              pressed && styles.pressed,
              processing && styles.scanButtonDisabled,
            ]}
            onPress={processImage}
            disabled={processing}
          >
            {processing ? (
              <View style={styles.processingRow}>
                <ActivityIndicator color={C.white} />
                <Text style={styles.scanButtonText}>Processing...</Text>
              </View>
            ) : (
              <View style={styles.processingRow}>
                <Ionicons name="scan" size={22} color={C.white} />
                <Text style={styles.scanButtonText}>Scan & Grade</Text>
              </View>
            )}
          </Pressable>
        ) : null}

        {selectedKey ? (
          <View style={[styles.infoCard, { marginTop: 20 }]}>
            <Ionicons name="information-circle" size={20} color={C.sky} />
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
  sectionTitle: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
    marginBottom: 12,
  },
  keyList: { gap: 10 },
  keyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: C.white,
    borderWidth: 1.5,
    borderColor: C.primaryLight,
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
    backgroundColor: C.white,
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
    backgroundColor: C.white,
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
    backgroundColor: '#EDF6FF',
    borderRadius: 14,
    padding: 14,
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
