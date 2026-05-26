import { getApiUrl } from './query-client';
import { authHeaders } from './auth-token';
import type { AnswerKey, ScanResult } from './types';

function apiUrl(path: string): string {
  return `${getApiUrl()}${path}`;
}

export async function getAnswerKeys(): Promise<AnswerKey[]> {
  try {
    const res = await fetch(apiUrl('api/keys'), { headers: authHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function saveAnswerKey(key: AnswerKey): Promise<void> {
  await fetch(apiUrl('api/keys'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(key),
  });
}

export async function deleteAnswerKey(id: string): Promise<void> {
  await fetch(apiUrl(`api/keys/${id}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function getScanResults(): Promise<ScanResult[]> {
  try {
    const res = await fetch(apiUrl('api/results'), { headers: authHeaders() });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function saveScanResult(result: ScanResult): Promise<void> {
  await fetch(apiUrl('api/results'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(result),
  });
}

export async function deleteScanResult(id: string): Promise<void> {
  await fetch(apiUrl(`api/results/${id}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
}

export async function clearAllData(): Promise<void> {}
