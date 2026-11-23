import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Link, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/theme/primitives';
import { tokens } from '@/theme/tokens';
import { Spacing, Typography } from '@/constants/Layout';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Screen Not Found' }} />
      <View style={[styles.container, { backgroundColor: tokens.color.bg }]}>
        <Ionicons name="alert-circle-outline" size={48} color={tokens.color.textMuted} />
        <Text style={[styles.title, { color: tokens.color.text }]}>Page Not Found</Text>
        <Text style={[styles.description, { color: tokens.color.textMuted }]}>
          The page you are looking for is not available.
        </Text>
        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: tokens.color.info }]}>Return to Home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.semibold,
  },
  description: {
    fontSize: Typography.size.sm,
    color: tokens.color.textMuted,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  link: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  linkText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
  },
});
