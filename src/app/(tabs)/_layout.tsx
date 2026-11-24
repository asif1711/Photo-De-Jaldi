import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { tokens } from '@/theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: {
          backgroundColor: tokens.color.surface,
          shadowColor: 'transparent',
          elevation: 0,
          borderBottomWidth: 1,
          borderBottomColor: tokens.color.border,
        },
        headerTitleStyle: {
          fontFamily: 'GoogleSansFlex_600SemiBold',
          fontSize: 18,
          color: tokens.color.text,
        },
        tabBarStyle: {
          backgroundColor: tokens.color.surface,
          borderTopWidth: 1,
          borderTopColor: tokens.color.border,
          elevation: 0,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: tokens.color.primaryText,
        tabBarInactiveTintColor: tokens.color.textMuted,
        tabBarLabelStyle: {
          fontFamily: 'GoogleSansFlex_500Medium',
          fontSize: 12,
        },
        sceneStyle: {
          backgroundColor: tokens.color.bg,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: 'Photo De Jaldi',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'folder' : 'folder-outline'}
              size={size}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          headerTitle: 'Shared Inbox',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'file-tray-full' : 'file-tray-full-outline'}
              size={size}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          headerTitle: 'Bucket History',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'time' : 'time-outline'}
              size={size}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="storage"
        options={{
          title: 'Storage',
          headerTitle: 'Storage',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'cloud' : 'cloud-outline'}
              size={size}
              color={color as string}
            />
          ),
        }}
      />
    </Tabs>
  );
}
