import { getApiUrl } from './query-client';
import { authHeaders } from './auth-token';
import type { AnswerKey, ScanResult } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS_STORAGE_KEY = 'bubblescan_answer_keys';
const RESULTS_STORAGE_KEY = 'bubblescan_scan_results';

function apiUrl(path: string): string {
  return `${getApiUrl()}${path}`;
}

async function getLocalKeys(): Promise<AnswerKey[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function setLocalKeys(keys: AnswerKey[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch (e) {
    console.error('Failed to save keys locally:', e);
  }
}

export async function getAnswerKeys(): Promise<AnswerKey[]> {
  const localKeys = await getLocalKeys();
  try {
    const res = await fetch(apiUrl('api/keys'), { headers: authHeaders() });
    if (res.ok) {
      const serverKeys: AnswerKey[] = await res.json();
      // Merge server keys and local keys (prefer newer by ID)
      const map = new Map<string, AnswerKey>();
      for (const k of localKeys) map.set(k.id, k);
      for (const k of serverKeys) map.set(k.id, k);
      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      await setLocalKeys(merged);
      return merged;
    }
  } catch (e) {
    // offline or network error
  }
  return localKeys;
}

export async function saveAnswerKey(key: AnswerKey): Promise<void> {
  // 1. Immediately save to local persistent storage
  const localKeys = await getLocalKeys();
  const existingIdx = localKeys.findIndex((k) => k.id === key.id);
  if (existingIdx >= 0) {
    localKeys[existingIdx] = key;
  } else {
    localKeys.unshift(key);
  }
  await setLocalKeys(localKeys);

  // 2. Sync with backend API
  try {
    await fetch(apiUrl('api/keys'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(key),
    });
  } catch (e) {
    console.warn('Could not sync key to server:', e);
  }
}

export async function deleteAnswerKey(id: string): Promise<void> {
  // 1. Remove from local storage
  const localKeys = await getLocalKeys();
  const filtered = localKeys.filter((k) => k.id !== id);
  await setLocalKeys(filtered);

  // 2. Delete from backend API
  try {
    await fetch(apiUrl(`api/keys/${id}`), {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (e) {
    console.warn('Could not delete key from server:', e);
  }
}

async function getLocalResults(): Promise<ScanResult[]> {
  try {
    const raw = await AsyncStorage.getItem(RESULTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function setLocalResults(results: ScanResult[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RESULTS_STORAGE_KEY, JSON.stringify(results));
  } catch (e) {
    console.error('Failed to save results locally:', e);
  }
}

export async function getScanResults(): Promise<ScanResult[]> {
  const localResults = await getLocalResults();
  try {
    const res = await fetch(apiUrl('api/results'), { headers: authHeaders() });
    if (res.ok) {
      const serverResults: ScanResult[] = await res.json();
      const map = new Map<string, ScanResult>();
      for (const r of localResults) map.set(r.id, r);
      for (const r of serverResults) map.set(r.id, r);
      const merged = Array.from(map.values()).sort(
        (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
      );
      await setLocalResults(merged);
      return merged;
    }
  } catch {
    // offline
  }
  return localResults;
}

export async function saveScanResult(result: ScanResult): Promise<void> {
  const localResults = await getLocalResults();
  const existingIdx = localResults.findIndex((r) => r.id === result.id);
  if (existingIdx >= 0) {
    localResults[existingIdx] = result;
  } else {
    localResults.unshift(result);
  }
  await setLocalResults(localResults);

  try {
    await fetch(apiUrl('api/results'), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(result),
    });
  } catch (e) {
    console.warn('Could not sync result to server:', e);
  }
}

export async function deleteScanResult(id: string): Promise<void> {
  const localResults = await getLocalResults();
  const filtered = localResults.filter((r) => r.id !== id);
  await setLocalResults(filtered);

  try {
    await fetch(apiUrl(`api/results/${id}`), {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (e) {
    console.warn('Could not delete result from server:', e);
  }
}

export async function clearAllData(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEYS_STORAGE_KEY);
    await AsyncStorage.removeItem(RESULTS_STORAGE_KEY);
  } catch {}
}
