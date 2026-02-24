import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnswerKey, ScanResult } from './types';

const KEYS_STORAGE = '@bubblescan_keys';
const RESULTS_STORAGE = '@bubblescan_results';

export async function getAnswerKeys(): Promise<AnswerKey[]> {
  const data = await AsyncStorage.getItem(KEYS_STORAGE);
  return data ? JSON.parse(data) : [];
}

export async function saveAnswerKey(key: AnswerKey): Promise<void> {
  const keys = await getAnswerKeys();
  const idx = keys.findIndex(k => k.id === key.id);
  if (idx >= 0) {
    keys[idx] = key;
  } else {
    keys.unshift(key);
  }
  await AsyncStorage.setItem(KEYS_STORAGE, JSON.stringify(keys));
}

export async function deleteAnswerKey(id: string): Promise<void> {
  const keys = await getAnswerKeys();
  await AsyncStorage.setItem(KEYS_STORAGE, JSON.stringify(keys.filter(k => k.id !== id)));
}

export async function getScanResults(): Promise<ScanResult[]> {
  const data = await AsyncStorage.getItem(RESULTS_STORAGE);
  return data ? JSON.parse(data) : [];
}

export async function saveScanResult(result: ScanResult): Promise<void> {
  const results = await getScanResults();
  results.unshift(result);
  await AsyncStorage.setItem(RESULTS_STORAGE, JSON.stringify(results));
}

export async function deleteScanResult(id: string): Promise<void> {
  const results = await getScanResults();
  await AsyncStorage.setItem(RESULTS_STORAGE, JSON.stringify(results.filter(r => r.id !== id)));
}

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS_STORAGE, RESULTS_STORAGE]);
}
