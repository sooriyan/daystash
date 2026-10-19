import { Queue, JobsOptions } from 'bullmq';
import { getRedisClient } from './redis';

export const REMINDER_SCHEDULER_QUEUE_NAME = 'reminder-scheduler';
export const SILENT_PUSH_QUEUE_NAME = 'silent-push-notifications';

declare global {
  // eslint-disable-next-line no-var
  var __reminderSchedulerQueue: Queue | undefined;
  // eslint-disable-next-line no-var
  var __silentPushQueue: Queue | undefined;
}

/**
 * BullMQ Queue for scheduling delayed reminder dispatch executions.
 */
export function getReminderSchedulerQueue(): Queue {
  if (process.env.NODE_ENV === 'production') {
    return new Queue(REMINDER_SCHEDULER_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });
  }

  if (!globalThis.__reminderSchedulerQueue) {
    globalThis.__reminderSchedulerQueue = new Queue(REMINDER_SCHEDULER_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  return globalThis.__reminderSchedulerQueue;
}

/**
 * BullMQ Queue for dispatching silent APNs / FCM push notifications
 * to notify peer client devices to trigger a background delta sync.
 */
export function getSilentPushQueue(): Queue {
  if (process.env.NODE_ENV === 'production') {
    return new Queue(SILENT_PUSH_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 1000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });
  }

  if (!globalThis.__silentPushQueue) {
    globalThis.__silentPushQueue = new Queue(SILENT_PUSH_QUEUE_NAME, {
      connection: getRedisClient(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }

  return globalThis.__silentPushQueue;
}

export interface ReminderJobPayload {
  reminderId: string;
  userId: string;
  title: string;
  nextTriggerUtc: string;
}

export interface SilentPushJobPayload {
  userId: string;
  excludedDeviceId?: string;
  mutatedReminderIds: string[];
  timestamp: string;
}

/**
 * Enqueues or updates a delayed job in BullMQ to trigger a reminder notification.
 * Uses a deterministic jobId (`reminder-${reminderId}`) to prevent duplicates.
 */
export async function scheduleReminderJob(
  reminderId: string,
  userId: string,
  title: string,
  nextTriggerUtc: Date
): Promise<void> {
  try {
    const queue = getReminderSchedulerQueue();
    const jobId = `reminder-${reminderId}`;

    // Remove any existing scheduled job for this reminder to reschedule with new timing
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    const now = Date.now();
    const triggerTime = nextTriggerUtc.getTime();
    const delay = Math.max(0, triggerTime - now);

    const payload: ReminderJobPayload = {
      reminderId,
      userId,
      title,
      nextTriggerUtc: nextTriggerUtc.toISOString(),
    };

    const options: JobsOptions = {
      jobId,
      delay,
    };

    await queue.add('trigger-reminder', payload, options);
  } catch (error) {
    console.error(`[BullMQ] Failed to schedule reminder job for reminderId ${reminderId}:`, error);
  }
}

/**
 * Cancels an existing delayed reminder job (e.g., when completed, archived, or deleted).
 */
export async function cancelReminderJob(reminderId: string): Promise<void> {
  try {
    const queue = getReminderSchedulerQueue();
    const jobId = `reminder-${reminderId}`;

    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
    }
  } catch (error) {
    console.error(`[BullMQ] Failed to cancel reminder job for reminderId ${reminderId}:`, error);
  }
}

/**
 * Enqueues a silent push job to notify peer devices that remote changes occurred.
 */
export async function enqueueSilentPushJob(payload: SilentPushJobPayload): Promise<void> {
  try {
    const queue = getSilentPushQueue();
    await queue.add('silent-sync-broadcast', payload, {
      removeOnComplete: true,
      attempts: 3,
    });
  } catch (error) {
    console.error(`[BullMQ] Failed to enqueue silent push job for userId ${payload.userId}:`, error);
  }
}
