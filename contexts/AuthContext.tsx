import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getApiUrl } from '@/lib/query-client';
import { setAuthToken } from '@/lib/auth-token';

const TOKEN_KEY = 'bubblescan_token';
const USER_KEY = 'bubblescan_user';

interface User {
  userId: string;
  username: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

async function storeSecure(key: string, value: string) {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(key, value); } catch {}
  } else {
    await SecureStore.setItemAsync(key, value);
  }
}

async function getSecure(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  return SecureStore.getItemAsync(key);
}

async function deleteSecure(key: string) {
  if (Platform.OS === 'web') {
    try { localStorage.removeItem(key); } catch {}
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getSecure(TOKEN_KEY);
        const userData = await getSecure(USER_KEY);
        if (token && userData) {
          setAuthToken(token);
          setUser(JSON.parse(userData));
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${getApiUrl()}api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    await storeSecure(TOKEN_KEY, data.token);
    await storeSecure(USER_KEY, JSON.stringify(data.user));
    setAuthToken(data.token);
    setUser(data.user);
  };

  const register = async (username: string, password: string) => {
    const res = await fetch(`${getApiUrl()}api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    await storeSecure(TOKEN_KEY, data.token);
    await storeSecure(USER_KEY, JSON.stringify(data.user));
    setAuthToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    await deleteSecure(TOKEN_KEY);
    await deleteSecure(USER_KEY);
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
