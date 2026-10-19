import type { SQLiteDatabase } from 'expo-sqlite';
import {
  scheduleLocalReminderNotificationAsync,
  cancelScheduledNotificationAsync,
} from './notificationService.js';
import type { LocalReminderRow } from './db.js';

export interface RollingWindowOptions {
  /**
   * Maximum number of notifications to keep scheduled in the native OS queue.
   * Default is 50 (leaves headroom below the iOS 64-notification ceiling).
   */
  maxScheduledCount?: number;

  /**
   * Horizon in days for the scheduling window. Default is 14 days.
   */
  windowDays?: number;
}

export interface RollingWindowResult {
  scheduledCount: number;
  cancelledCount: number;
}

/**
 * Reconciles the rolling notification window:
 * Ensures the next N upcoming active reminders have OS local notifications scheduled,
 * and cancels obsolete notifications for completed, archived, or deleted reminders.
 */
export async function reconcileRollingWindow(
  db: SQLiteDatabase,
  options: RollingWindowOptions = {}
): Promise<RollingWindowResult> {
  const maxScheduledCount = options.maxScheduledCount ?? 50;
  const windowDays = options.windowDays ?? 14;

  const now = new Date();
  const nowIso = now.toISOString();
  const windowEndIso = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString();

  let scheduledCount = 0;
  let cancelledCount = 0;

  // 1. Cancel obsolete notifications for inactive, soft-deleted, or expired reminders
  const obsoleteRows = db.getAllSync<Pick<LocalReminderRow, 'id' | 'local_notification_id'>>(
    `SELECT id, local_notification_id FROM reminders
     WHERE local_notification_id IS NOT NULL
       AND (status != 'ACTIVE' OR deleted_at IS NOT NULL OR next_trigger_utc IS NULL OR next_trigger_utc < ?)`,
    [nowIso]
  );

  for (const row of obsoleteRows) {
    if (row.local_notification_id) {
      await cancelScheduledNotificationAsync(row.local_notification_id);
      db.runSync('UPDATE reminders SET local_notification_id = NULL WHERE id = ?', [row.id]);
      cancelledCount++;
    }
  }

  // 2. Fetch upcoming active reminders within the scheduling window
  const upcomingRows = db.getAllSync<LocalReminderRow>(
    `SELECT * FROM reminders
     WHERE status = 'ACTIVE'
       AND deleted_at IS NULL
       AND next_trigger_utc IS NOT NULL
       AND next_trigger_utc >= ?
       AND next_trigger_utc <= ?
     ORDER BY next_trigger_utc ASC
     LIMIT ?`,
    [nowIso, windowEndIso, maxScheduledCount]
  );

  // 3. Ensure each upcoming reminder has an active notification scheduled
  for (const reminder of upcomingRows) {
    if (!reminder.next_trigger_utc) continue;

    // If already has local_notification_id, consider it active
    if (reminder.local_notification_id) {
      continue;
    }

    const triggerDate = new Date(reminder.next_trigger_utc);
    if (triggerDate.getTime() > Date.now()) {
      const newNotificationId = await scheduleLocalReminderNotificationAsync({
        id: reminder.id,
        title: reminder.title,
        notes: reminder.notes,
        triggerDate,
      });

      if (newNotificationId) {
        db.runSync(
          'UPDATE reminders SET local_notification_id = ? WHERE id = ?',
          [newNotificationId, reminder.id]
        );
        scheduledCount++;
      }
    }
  }

  return { scheduledCount, cancelledCount };
}
