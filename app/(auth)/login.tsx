import React, { useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, Pressable, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import Colors from '@/constants/colors';

const C = Colors.light;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const webTop = Platform.OS === 'web' ? 67 : 0;

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48 + webTop, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <LinearGradient colors={[C.primary, C.primaryDark]} style={styles.logo}>
            <Ionicons name="scan" size={28} color={C.white} />
          </LinearGradient>
          <Text style={styles.brand}>BubbleScan</Text>
        </View>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in to access your encrypted answer keys and results
        </Text>

        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={C.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.inputRow}>
              <Ionicons name="person-outline" size={18} color={C.textSecondary} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="your username"
                placeholderTextColor={C.textLight}
                autoCapitalize="none"
                autoCorrect={false}
                testID="login-username"
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={18} color={C.textSecondary} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="your password"
                placeholderTextColor={C.textLight}
                secureTextEntry={!showPw}
                testID="login-password"
                onSubmitEditing={handleLogin}
                returnKeyType="go"
              />
              <Pressable onPress={() => setShowPw(v => !v)} hitSlop={8}>
                <Ionicons
                  name={showPw ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color={C.textSecondary}
                />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
            onPress={handleLogin}
            disabled={loading}
            testID="login-btn"
          >
            {loading
              ? <ActivityIndicator color={C.white} />
              : <Text style={styles.btnText}>Sign In</Text>
            }
          </Pressable>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Don't have an account?</Text>
            <Pressable onPress={() => router.replace('/(auth)/register')}>
              <Text style={styles.switchLink}> Create one</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.securityNote}>
          <Ionicons name="shield-checkmark-outline" size={15} color={C.textSecondary} />
          <Text style={styles.securityText}>
            Data encrypted with AES-256 at rest
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scroll: { paddingHorizontal: 28 },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 44,
  },
  logo: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 26,
    color: C.text,
  },
  title: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 30,
    color: C.text,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 36,
    lineHeight: 21,
  },
  form: { gap: 18 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(244,63,94,0.3)',
  },
  errorText: {
    fontFamily: 'Nunito_500Medium',
    fontSize: 13,
    color: C.error,
    flex: 1,
  },
  field: { gap: 8 },
  label: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: C.text,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  input: {
    flex: 1,
    fontFamily: 'Nunito_500Medium',
    fontSize: 15,
    color: C.text,
  },
  btn: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontFamily: 'Nunito_700Bold',
    fontSize: 16,
    color: C.white,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  switchText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 14,
    color: C.textSecondary,
  },
  switchLink: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    color: C.primary,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 40,
  },
  securityText: {
    fontFamily: 'Nunito_400Regular',
    fontSize: 12,
    color: C.textSecondary,
  },
});
