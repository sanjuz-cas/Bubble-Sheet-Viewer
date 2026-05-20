import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, FlatList, Pressable, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { getAnswerKeys, deleteAnswerKey } from '@/lib/storage';
import type { AnswerKey } from '@/lib/types';
import Colors from '@/constants/colors';

const C = Colors.light;

const subjectIcons: Record<string, string> = {
  Math: 'calculator',
  Science: 'flask',
  English: 'book',
  History: 'globe',
  Geography: 'earth',
  Physics: 'nuclear',
  Chemistry: 'beaker',
  Biology: 'leaf',
};

function KeyCard({ item, onDelete }: { item: AnswerKey; onDelete: () => void }) {
  const iconName = (subjectIcons[item.subject] || 'school') as any;

  return (
    <Pressable
      style={({ pressed }) => [styles.keyCard, pressed && styles.pressed]}
      onPress={() => router.push({ pathname: '/edit-key', params: { keyId: item.id } })}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert(
          'Delete Answer Key',
          `Remove "${item.name}"?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: onDelete },
          ]
        );
      }}
    >
      <View style={styles.keyCardIcon}>
        <Ionicons name={iconName} size={22} color={C.primary} />
      </View>
      <View style={styles.keyCardContent}>
        <Text style={styles.keyCardName}>{item.name}</Text>
        <Text style={styles.keyCardSubject}>{item.subject}</Text>
        <View style={styles.keyCardMeta}>
          <View style={styles.metaBadge}>
            <Text style={styles.metaText}>{item.totalQuestions} Q</Text>
          </View>
          <View style={[styles.metaBadge, { backgroundColor: C.secondaryLight }]}>
            <Text style={styles.metaText}>{item.optionsPerQuestion} options</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.textLight} />
    </Pressable>
  );
}

export default function KeysScreen() {
  const insets = useSafeAreaInsets();
  const [keys, setKeys] = useState<AnswerKey[]>([]);

  const loadKeys = useCallback(async () => {
    const k = await getAnswerKeys();
    setKeys(k);
  }, []);

  useFocusEffect(useCallback(() => { loadKeys(); }, [loadKeys]));

  const handleDelete = async (id: string) => {
    await deleteAnswerKey(id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    loadKeys();
  };

  const webTopInset = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 + webTopInset }]}>
        <View>
          <Text style={styles.title}>Answer Keys</Text>
          <Text style={styles.subtitle}>Manage your answer templates</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/edit-key');
          }}
        >
          <Ionicons name="add" size={24} color={C.white} />
        </Pressable>
      </View>

      <FlatList
        data={keys}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <KeyCard item={item} onDelete={() => handleDelete(item.id)} />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!keys.length}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="key-outline" size={64} color={C.primaryLight} />
            <Text style={styles.emptyTitle}>No answer keys yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap the + button to create your first answer key
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 20,
    gap: 12,
  },
  keyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    gap: 14,
  },
  keyCardIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#2A1018',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCardContent: { flex: 1 },
  keyCardName: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.text,
  },
  keyCardSubject: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  keyCardMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  metaBadge: {
    backgroundColor: C.lavender,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metaText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 11,
    color: C.text,
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
