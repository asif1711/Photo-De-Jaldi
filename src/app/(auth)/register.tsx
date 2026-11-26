import React, { useRef, useState } from 'react';
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

export default function RegisterScreen() {
  const router = useRouter();
  const { signUp, isConfigured } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const submissionInProgress = useRef(false);

  const validate = () => {
    let isValid = true;
    setEmailError(null);
    setPasswordError(null);
    setConfirmPasswordError(null);
    setErrorMessage(null);
    setInfoMessage(null);

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
    } else if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      isValid = false;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError('Passwords do not match');
      isValid = false;
    }

    return isValid;
  };

  const handleRegister = async () => {
    if (submissionInProgress.current || !validate()) return;

    submissionInProgress.current = true;
    setLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const { success, error, needsEmailConfirmation } = await signUp(
        email.trim(),
        password
      );

      if (!success && error) {
        setErrorMessage(error);
      } else if (needsEmailConfirmation) {
        setInfoMessage(
          'Account created! A confirmation link has been sent to your email. Please verify your address and then sign in.'
        );
      }
    } finally {
      submissionInProgress.current = false;
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: tokens.color.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.brandContainer}>
          <View style={[styles.logoCircle, { backgroundColor: tokens.color.surfaceRaised }]}>
            <Ionicons name="person-add-outline" size={32} color={tokens.color.info} />
          </View>
          <Text style={[styles.brandTitle, { color: tokens.color.text }]}>Create Account</Text>
          <Text style={[styles.brandSubtitle, { color: tokens.color.textMuted }]}>
            Join Photo De Jaldi to share and receive temporary file collections
          </Text>
        </View>

        {/* Configuration Notice if unconfigured */}
        {!isConfigured && (
          <Card variant="subtle" style={styles.warningCard}>
            <View style={styles.warningRow}>
              <Ionicons name="warning-outline" size={20} color={tokens.color.warning} />
              <View style={styles.warningTextContainer}>
                <Text style={[styles.warningTitle, { color: tokens.color.text }]}>
                  Sign-Up Temporarily Unavailable
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
          <Text style={[styles.formTitle, { color: tokens.color.text }]}>Register</Text>

          {errorMessage && (
            <View style={[styles.banner, { backgroundColor: tokens.color.dangerSoft }]}>
              <Ionicons name="alert-circle" size={18} color={tokens.color.danger} />
              <Text style={[styles.bannerText, { color: tokens.color.danger }]}>
                {errorMessage}
              </Text>
            </View>
          )}

          {infoMessage && (
            <View style={[styles.banner, { backgroundColor: tokens.color.primarySoft }]}>
              <Ionicons name="checkmark-circle" size={18} color={tokens.color.primaryText} />
              <Text style={[styles.bannerText, { color: tokens.color.primaryText }]}>
                {infoMessage}
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
            placeholder="At least 6 characters"
            isPassword
            autoComplete="new-password"
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

          <Input
            label="Confirm Password"
            placeholder="Re-enter your password"
            isPassword
            autoComplete="new-password"
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (confirmPasswordError) setConfirmPasswordError(null);
            }}
            error={confirmPasswordError}
            leftIcon={
              <Ionicons name="lock-closed-outline" size={20} color={tokens.color.textMuted} />
            }
          />

          <Button
            title="Create Account"
            onPress={handleRegister}
            loading={loading}
            style={styles.submitButton}
            icon={<Ionicons name="arrow-forward-outline" size={18} color={tokens.color.onPrimary} />}
          />

          <View style={styles.switchAuthRow}>
            <Text style={[styles.switchAuthText, { color: tokens.color.textMuted }]}>
              Already have an account?{' '}
            </Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
              <Text style={[styles.switchAuthLink, { color: tokens.color.info }]}>
                Sign In
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
    paddingTop: Spacing.xxxl * 1.2,
    paddingBottom: Spacing.xxxl,
    justifyContent: 'center',
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  bannerText: {
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
;
