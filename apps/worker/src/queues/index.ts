import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const REMINDER_TRIGGER_QUEUE_NAME = 'reminder-trigger-queue';
export const SILENT_SYNC_QUEUE_NAME = 'silent-sync-queue';
export const EXPO_RECEIPT_AUDIT_QUEUE_NAME = 'expo-receipt-audit-queue';

let redisInstance: Redis | null = null;

/**
 * Returns a shared Redis connection configured for BullMQ.
 */
export function getRedisConnection(): Redis {
  if (!redisInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    redisInstance = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return redisInstance;
}

/**
 * Payload for a reminder trigger dispatch job.
 */
export interface ReminderTriggerJobData {
  reminderId: string;
  userId: string;
  title: string;
  notes?: string | null;
  triggerUtcEpoch: number;
}

/**
 * Payload for a silent background push sync job.
 */
export interface SilentSyncJobData {
  userId: string;
  excludedDeviceId?: string;
  mutatedReminderIds?: string[];
  timestamp: string;
}

/**
 * Payload for an Expo push receipt audit job.
 * Maps ticketIds to their corresponding ExpoPushTokens so invalid tokens can be pruned.
 */
export interface ReceiptAuditJobData {
  ticketIds: string[];
  tokenMap: Record<string, string>;
}

/**
 * 1. reminder-trigger-queue:
 * Fires matured reminders using deterministic jobId = reminder_${id}_${nextTriggerUtcEpoch}
 * for strict deduplication and idempotent dispatch.
 */
export const reminderTriggerQueue = new Queue<ReminderTriggerJobData>(
  REMINDER_TRIGGER_QUEUE_NAME,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  }
);

/**
 * 2. silent-sync-queue:
 * Dispatches background `_contentAvailable: true` data pushes to peer devices.
 */
export const silentSyncQueue = new Queue<SilentSyncJobData>(
  SILENT_SYNC_QUEUE_NAME,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 1000,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  }
);

/**
 * 3. expo-receipt-audit-queue:
 * Verifies Expo Push Receipts 15 minutes after dispatch to prune dead tokens.
 */
export const expoReceiptAuditQueue = new Queue<ReceiptAuditJobData>(
  EXPO_RECEIPT_AUDIT_QUEUE_NAME,
  {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
    },
  }
);
