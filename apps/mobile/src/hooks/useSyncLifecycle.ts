import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import {
  performDeltaSync,
  type SyncOptions,
  type DeltaSyncResult,
} from '../services/syncEngine.js';

export interface UseSyncLifecycleOptions extends SyncOptions {
  /**
   * Whether the sync lifecycle listeners are active. Default is true.
   */
  enabled?: boolean;

  /**
   * Callback fired upon successful delta synchronization.
   */
  onSyncComplete?: (result: DeltaSyncResult) => void;

  /**
   * Callback fired when a sync attempt fails.
   */
  onSyncError?: (error: Error) => void;

  /**
   * Minimum duration in milliseconds between triggered syncs to prevent flapping.
   * Default is 2000ms.
   */
  debounceIntervalMs?: number;
}

export interface SyncLifecycleState {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  syncError: Error | null;
  triggerSync: (reason?: string) => Promise<DeltaSyncResult | null>;
}

/**
 * React hook that manages the multi-device sync lifecycle for React Native:
 * 1. App Foreground: triggers sync on AppState change to 'active'.
 * 2. Network Reconnect: triggers sync when NetInfo detects connectivity restored.
 * 3. Silent Push: triggers sync on remote push notification with type === 'SILENT_SYNC'.
 */
export function useSyncLifecycle(
  options: UseSyncLifecycleOptions = {}
): SyncLifecycleState {
  const {
    enabled = true,
    onSyncComplete,
    onSyncError,
    debounceIntervalMs = 2000,
    ...syncOptions
  } = options;

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<Error | null>(null);

  const lastSyncTimestampRef = useRef<number>(0);
  const wasConnectedRef = useRef<boolean | null>(null);

  // Keep options in a ref to avoid recreating triggerSync on every render
  const optionsRef = useRef({ ...syncOptions, onSyncComplete, onSyncError });
  useEffect(() => {
    optionsRef.current = { ...syncOptions, onSyncComplete, onSyncError };
  });

  const triggerSync = useCallback(
    async (reason: string = 'MANUAL'): Promise<DeltaSyncResult | null> => {
      const now = Date.now();
      if (now - lastSyncTimestampRef.current < debounceIntervalMs) {
        console.log(`[useSyncLifecycle] Skipping sync triggered by ${reason} (debounced).`);
        return null;
      }

      lastSyncTimestampRef.current = now;
      setIsSyncing(true);
      setSyncError(null);

      try {
        console.log(`[useSyncLifecycle] Initiating delta sync [trigger: ${reason}]...`);
        const result = await performDeltaSync(optionsRef.current);

        setLastSyncedAt(result.syncedAt);
        optionsRef.current.onSyncComplete?.(result);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`[useSyncLifecycle] Sync failed [trigger: ${reason}]:`, error);
        setSyncError(error);
        optionsRef.current.onSyncError?.(error);
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [debounceIntervalMs]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // 1. App State Listener (triggers sync when app comes to foreground)
    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          triggerSync('APP_FOREGROUND');
        }
      }
    );

    // 2. Network Connectivity Listener (triggers sync when connection is restored)
    const netInfoSubscription = NetInfo.addEventListener((state: NetInfoState) => {
      const isConnected = Boolean(state.isConnected && state.isInternetReachable !== false);

      // Only trigger if transitioning from disconnected to connected
      if (wasConnectedRef.current === false && isConnected) {
        triggerSync('NETWORK_RECONNECT');
      }

      wasConnectedRef.current = isConnected;
    });

    // 3. Silent Push Notification Listener (triggers sync on background/foreground silent push)
    const notificationSubscription = Notifications.addNotificationReceivedListener(
      (notification: Notifications.Notification) => {
        const data = notification.request.content.data;
        if (data && data.type === 'SILENT_SYNC') {
          console.log('[useSyncLifecycle] Received SILENT_SYNC push notification.');
          triggerSync('SILENT_PUSH');
        }
      }
    );

    // 4. Initial Sync on component mount
    triggerSync('INITIAL_MOUNT');

    // Cleanup all subscriptions on unmount
    return () => {
      appStateSubscription.remove();
      netInfoSubscription();
      notificationSubscription.remove();
    };
  }, [enabled, triggerSync]);

  return {
    isSyncing,
    lastSyncedAt,
    syncError,
    triggerSync,
  };
}
