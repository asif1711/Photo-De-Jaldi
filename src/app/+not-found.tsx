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
        <Text style={[styles.title, { color: tokens.color.text }]}>This screen doesn't exist.</Text>
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
  link: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  linkText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
  },
});
