import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const validate = () => {
    let isValid = true;
    setEmailError(null);
    setPasswordError(null);
    setErrorMessage(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) {
      setEmailError('Email is required');
      isValid = false;
    } else if (!emailRegex.test(email.trim())) {
      setEmailError('Please enter a valid email address');
      isValid = false;
    }

    if (!password) {
      setPasswordError('Password is required');
      isValid = false;
    }

    return isValid;
  };

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);
    setErrorMessage(null);

    const { success, error } = await signIn(email.trim(), password);
    setLoading(false);

    if (!success && error) {
      setErrorMessage(error);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: tokens.color.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {/* Header / Branding */}
        <View style={styles.brandContainer}>
          <View style={[styles.logoCircle, { backgroundColor: tokens.color.surfaceRaised }]}>
            <Ionicons name="flash-outline" size={36} color={tokens.color.info} />
          </View>
          <Text style={[styles.brandTitle, { color: tokens.color.text }]}>Photo De Jaldi</Text>
          <Text style={[styles.brandSubtitle, { color: tokens.color.textMuted }]}>
            Temporary, zero-friction shared file collections
          </Text>
        </View>

        {/* Configuration Notice if Supabase is unconfigured */}
        {!isConfigured && (
          <Card variant="subtle" style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Ionicons name="warning-outline" size={20} color={tokens.color.warning} />
              <View style={styles.warningTextContainer}>
                <Text style={[styles.warningTitle, { color: tokens.color.text }]}>
                  Sign-In Temporarily Unavailable
                </Text>
                <Text style={[styles.warningDescription, { color: tokens.color.textMuted }]}>
                  Authentication is not yet configured. Please try again later.
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* Form Card */}
        <Card style={styles.formCard}>
          <Text style={[styles.formTitle, { color: tokens.color.text }]}>Sign In</Text>

          {errorMessage && (
            <View style={[styles.errorBanner, { backgroundColor: tokens.color.dangerSoft }]}>
              <Ionicons name="alert-circle" size={18} color={tokens.color.danger} />
              <Text style={[styles.errorBannerText, { color: tokens.color.danger }]}>
                {errorMessage}
              </Text>
            </View>
          )}

          <Input
            label="Email Address"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (emailError) setEmailError(null);
            }}
            error={emailError}
            leftIcon={
              <Ionicons name="mail-outline" size={20} color={tokens.color.textMuted} />
            }
          />

          <Input
            label="Password"
            placeholder="Enter your password"
            isPassword
            autoComplete="password"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) setPasswordError(null);
            }}
            error={passwordError}
            leftIcon={
              <Ionicons name="lock-closed-outline" size={20} color={tokens.color.textMuted} />
            }
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            style={styles.submitButton}
            icon={<Ionicons name="log-in-outline" size={18} color={tokens.color.onPrimary} />}
          />

          <View style={styles.switchAuthRow}>
            <Text style={[styles.switchAuthText, { color: tokens.color.textMuted }]}>
              Don't have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text style={[styles.switchAuthLink, { color: tokens.color.info }]}>
                Register
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.xxxl * 1.5,
    paddingBottom: Spacing.xxxl,
    justifyContent: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  brandTitle: {
    fontSize: Typography.size.title,
    fontWeight: Typography.weight.bold,
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: Typography.size.sm,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  warningCard: {
    marginBottom: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.warning,
  },
  warningRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  warningTextContainer: {
    flex: 1,
  },
  warningTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    marginBottom: Spacing.xs,
  },
  warningDescription: {
    fontSize: Typography.size.xs,
    lineHeight: 18,
  },
  codeText: {
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  formCard: {
    padding: Spacing.xl,
  },
  formTitle: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.lg,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorBannerText: {
    fontSize: Typography.size.sm,
    flex: 1,
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
  switchAuthRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  switchAuthText: {
    fontSize: Typography.size.sm,
  },
  switchAuthLink: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.bold,
  },
});
