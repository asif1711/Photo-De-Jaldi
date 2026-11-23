import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useColorScheme';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Card } from '@/components/common/Card';
import { createBucket } from '@/services/bucket';
import { formatDate } from '@/utils/formatters';
import { BorderRadius, Spacing, Typography } from '@/constants/Layout';

interface ExpiryPreset {
  label: string;
  hours: number;
}

const EXPIRY_PRESETS: ExpiryPreset[] = [
  { label: '6 Hours', hours: 6 },
  { label: '24 Hours (1 Day)', hours: 24 },
  { label: '48 Hours (2 Days)', hours: 48 },
  { label: '72 Hours (3 Days)', hours: 72 },
  { label: '7 Days', hours: 168 },
];

export default function CreateBucketScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedHours, setSelectedHours] = useState<number>(24);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  // Calculate target expiry time based on selected hours
  const calculateExpiryDate = (hours: number): Date => {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  };

  const calculatedExpiry = calculateExpiryDate(selectedHours);

  const validate = (): boolean => {
    let isValid = true;
    setNameError(null);
    setErrorMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Bucket name is required.');
      isValid = false;
    } else if (trimmedName.length < 2) {
      setNameError('Bucket name must be at least 2 characters.');
      isValid = false;
    }

    if (calculatedExpiry.getTime() <= Date.now()) {
      setErrorMessage('Expiry date must be in the future.');
      isValid = false;
    }

    return isValid;
  };

  const handleCreate = async () => {
    if (!validate() || loading) return;

    setLoading(true);
    setErrorMessage(null);

    const result = await createBucket({
      name: name.trim(),
      description: description.trim() || undefined,
      expires_at: calculatedExpiry.toISOString(),
    });

    setLoading(false);

    if (result.error) {
      setErrorMessage(result.error);
    } else if (result.data) {
      Alert.alert(
        'Success',
        `Bucket "${result.data.name}" created successfully!`,
        [
          {
            text: 'View Bucket',
            onPress: () => {
              router.replace(`/bucket/${result.data!.id}`);
            },
          },
        ]
      );
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Create New Bucket',
          headerBackTitle: 'Back',
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled">
          {/* Information Card */}
          <Card variant="subtle" style={styles.introCard}>
            <View style={styles.introRow}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.primary} />
              <View style={styles.introTextContainer}>
                <Text style={[styles.introTitle, { color: colors.text }]}>
                  Temporary & Self-Cleaning
                </Text>
                <Text style={[styles.introDescription, { color: colors.textSecondary }]}>
                  Buckets store your files temporarily. They are automatically deleted when all members
                  complete their downloads or when the expiry time is reached.
                </Text>
              </View>
            </View>
          </Card>

          {/* Form Card */}
          <Card style={styles.formCard}>
            {errorMessage && (
              <View style={[styles.errorBanner, { backgroundColor: colors.dangerBg }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorBannerText, { color: colors.danger }]}>
                  {errorMessage}
                </Text>
              </View>
            )}

            {/* Bucket Name Input */}
            <Input
              label="Bucket Name *"
              placeholder="e.g. Wedding_Photos_Raw"
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (nameError) setNameError(null);
              }}
              error={nameError}
              leftIcon={<Ionicons name="folder-outline" size={20} color={colors.textSecondary} />}
            />

            {/* Description Input */}
            <Input
              label="Description (Optional)"
              placeholder="What are you sharing?"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              style={styles.multilineInput}
              leftIcon={<Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />}
            />

            {/* Expiry Duration Selection */}
            <View style={styles.expirySection}>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                Expiry Duration *
              </Text>
              <Text style={[styles.expiryPreview, { color: colors.primary }]}>
                Will expire: {formatDate(calculatedExpiry.toISOString())}
              </Text>

              <View style={styles.presetsGrid}>
                {EXPIRY_PRESETS.map((preset) => {
                  const isSelected = selectedHours === preset.hours;
                  return (
                    <TouchableOpacity
                      key={preset.hours}
                      onPress={() => setSelectedHours(preset.hours)}
                      style={[
                        styles.presetChip,
                        {
                          backgroundColor: isSelected ? colors.primaryLight : colors.surfaceSubtle,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                      ]}>
                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={16}
                        color={isSelected ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.presetLabel,
                          {
                            color: isSelected ? colors.primary : colors.text,
                            fontWeight: isSelected ? '600' : '400',
                          },
                        ]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Submit Button */}
            <Button
              title="Create Bucket"
              onPress={handleCreate}
              loading={loading}
              disabled={loading}
              style={styles.submitButton}
              icon={<Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxxl,
  },
  introCard: {
    marginBottom: Spacing.lg,
  },
  introRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  introTextContainer: {
    flex: 1,
  },
  introTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    marginBottom: 2,
  },
  introDescription: {
    fontSize: Typography.size.xs,
    lineHeight: 18,
  },
  formCard: {
    padding: Spacing.xl,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  errorBannerText: {
    fontSize: Typography.size.sm,
    flex: 1,
  },
  multilineInput: {
    height: 72,
    textAlignVertical: 'top',
    paddingTop: Spacing.sm,
  },
  expirySection: {
    marginBottom: Spacing.xl,
  },
  fieldLabel: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    marginBottom: 4,
  },
  expiryPreview: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    marginBottom: Spacing.md,
  },
  presetsGrid: {
    gap: Spacing.xs,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  presetLabel: {
    fontSize: Typography.size.sm,
  },
  submitButton: {
    marginTop: Spacing.sm,
  },
});
