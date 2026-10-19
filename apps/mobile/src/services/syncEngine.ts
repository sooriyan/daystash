import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getLocalDatabase,
  getMetaValue,
  setMetaValue,
  getOrCreateDeviceId,
  type LocalReminderRow,
} from './db.js';
import { cancelScheduledNotificationAsync } from './notificationService.js';
import { reconcileRollingWindow, type RollingWindowResult } from './rollingWindow.js';
import type {
  SyncRequest,
  SyncResponse,
  ReminderSyncMutation,
} from '@repo/core/validators/sync';

export interface SyncOptions {
  /**
   * Endpoint URL for /api/sync. Defaults to EXPO_PUBLIC_API_URL or http://localhost:3000/api/sync.
   */
  apiUrl?: string;

  /**
   * Authenticated user ID passed in x-user-id header.
   */
  userId?: string;

  /**
   * Bearer authorization token.
   */
  authToken?: string;

  /**
   * Optional custom SQLiteDatabase instance.
   */
  db?: SQLiteDatabase;

  /**
   * Maximum network retry attempts with exponential backoff.
   */
  maxRetries?: number;

  /**
   * Initial retry delay in milliseconds.
   */
  initialDelayMs?: number;
}

export interface DeltaSyncResult {
  success: boolean;
  syncedAt: string;
  appliedCount: number;
  deltaCount: number;
  conflictCount: number;
  rollingWindow: RollingWindowResult;
}

let isSyncInProgress = false;

/**
 * Executes an HTTP fetch with exponential backoff and jitter for resilient offline recovery.
 */
export async function fetchWithExponentialBackoff(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  initialDelayMs: number = 500,
  backoffMultiplier: number = 2
): Promise<Response> {
  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, options);

      // Return immediately on successful response or client 4xx validation errors (do not retry 4xx)
      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      throw new Error(`Server returned status: ${response.status}`);
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        throw error;
      }

      // Add jitter (+/- 20%) to avoid thundering herd problem
      const jitter = delay * (0.8 + Math.random() * 0.4);
      await new Promise((resolve) => setTimeout(resolve, jitter));
      delay *= backoffMultiplier;
    }
  }

  throw new Error(`Max retries (${maxRetries}) exceeded connecting to ${url}`);
}

/**
 * Performs bidirectional delta synchronization with the backend:
 * 1. Reads `last_synced_at` from local SQLite `meta` table.
 * 2. Queries all rows from local `reminders` where `sync_dirty = 1`.
 * 3. Sends payload to `POST /api/sync` with exponential backoff retry.
 * 4. Applies returned server changes inside a synchronous transaction (`db.withTransactionSync`).
 * 5. Cancels local notifications for completed/cancelled/deleted reminders.
 * 6. Marks synced local rows as `sync_dirty = 0`, updates `last_synced_at`, and runs `reconcileRollingWindow()`.
 */
export async function performDeltaSync(options: SyncOptions = {}): Promise<DeltaSyncResult> {
  if (isSyncInProgress) {
    console.log('[SyncEngine] Sync is already in progress, skipping concurrent invocation.');
    return {
      success: true,
      syncedAt: new Date().toISOString(),
      appliedCount: 0,
      deltaCount: 0,
      conflictCount: 0,
      rollingWindow: { scheduledCount: 0, cancelledCount: 0 },
    };
  }

  isSyncInProgress = true;

  try {
    const db = options.db ?? getLocalDatabase();
    const apiUrl =
      options.apiUrl ||
      process.env.EXPO_PUBLIC_API_URL ||
      'http://localhost:3000/api/sync';

    // 1. Read last_synced_at and device_id from local SQLite meta table
    const lastSyncedAt = getMetaValue(db, 'last_synced_at');
    const deviceId = getOrCreateDeviceId(db);

    // 2. Query all local reminders marked dirty (sync_dirty = 1)
    const dirtyRows = db.getAllSync<LocalReminderRow>(
      'SELECT * FROM reminders WHERE sync_dirty = 1'
    );

    const mutations: ReminderSyncMutation[] = dirtyRows.map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      rrule: row.rrule,
      timezone: row.timezone,
      nextTriggerUtc: row.next_trigger_utc,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));

    // Construct sync request payload
    const syncPayload: SyncRequest = {
      deviceId,
      lastSyncedAt: lastSyncedAt ?? null,
      clientTimestamp: new Date().toISOString(),
      mutations,
    };

    // 3. Send payload to POST /api/sync with exponential backoff retry
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options.userId) {
      headers['x-user-id'] = options.userId;
    }
    if (options.authToken) {
      headers['authorization'] = `Bearer ${options.authToken}`;
    }

    const response = await fetchWithExponentialBackoff(
      apiUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(syncPayload),
      },
      options.maxRetries ?? 3,
      options.initialDelayMs ?? 500
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sync API error [${response.status}]: ${errorText}`);
    }

    const syncResponse = (await response.json()) as SyncResponse;
    const { syncedAt, appliedRecordIds, conflicts, serverDeltas } = syncResponse;

    const notificationsToCancel: string[] = [];

    // 4. Apply returned server changes inside a synchronous SQLite transaction
    db.withTransactionSync(() => {
      // 4a. Process inbound server deltas
      for (const delta of serverDeltas) {
        const existing = db.getFirstSync<Pick<LocalReminderRow, 'id' | 'local_notification_id'>>(
          'SELECT id, local_notification_id FROM reminders WHERE id = ?',
          [delta.id]
        );

        // Check if reminder was marked COMPLETED, CANCELLED, or deleted on another device
        const isNowInactiveOrDeleted =
          delta.status === 'COMPLETED' ||
          (delta.status as string) === 'CANCELLED' ||
          delta.status === 'ARCHIVED' ||
          delta.deletedAt !== null;

        if (isNowInactiveOrDeleted && existing?.local_notification_id) {
          notificationsToCancel.push(existing.local_notification_id);
        }

        db.runSync(
          `INSERT INTO reminders (
            id, user_id, title, notes, rrule, timezone, next_trigger_utc,
            status, version, created_at, updated_at, deleted_at,
            local_notification_id, sync_dirty
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            title = excluded.title,
            notes = excluded.notes,
            rrule = excluded.rrule,
            timezone = excluded.timezone,
            next_trigger_utc = excluded.next_trigger_utc,
            status = excluded.status,
            version = excluded.version,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            local_notification_id = CASE
              WHEN ? = 1 THEN NULL
              ELSE reminders.local_notification_id
            END,
            sync_dirty = 0`,
          [
            delta.id,
            delta.userId,
            delta.title,
            delta.notes,
            delta.rrule,
            delta.timezone,
            delta.nextTriggerUtc,
            delta.status,
            delta.version,
            delta.createdAt,
            delta.updatedAt,
            delta.deletedAt,
            isNowInactiveOrDeleted ? null : (existing?.local_notification_id ?? null),
            isNowInactiveOrDeleted ? 1 : 0,
          ]
        );
      }

      // 4b. Mark synced local mutations as clean (sync_dirty = 0)
      if (appliedRecordIds.length > 0) {
        const placeholders = appliedRecordIds.map(() => '?').join(',');
        db.runSync(
          `UPDATE reminders SET sync_dirty = 0 WHERE id IN (${placeholders})`,
          appliedRecordIds
        );
      }

      // 4c. Update last_synced_at in local SQLite meta table
      setMetaValue(db, 'last_synced_at', syncedAt);
    });

    // 5. Cancel native OS notifications for completed/cancelled/deleted reminders
    for (const notificationId of notificationsToCancel) {
      await cancelScheduledNotificationAsync(notificationId);
    }

    // 6. Run rolling window reconciliation to schedule upcoming reminders
    const rollingWindow = await reconcileRollingWindow(db);

    return {
      success: true,
      syncedAt,
      appliedCount: appliedRecordIds.length,
      deltaCount: serverDeltas.length,
      conflictCount: conflicts.length,
      rollingWindow,
    };
  } finally {
    isSyncInProgress = false;
  }
}
