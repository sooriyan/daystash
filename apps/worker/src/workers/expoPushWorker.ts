import { Worker } from 'bullmq';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { eq, and, ne } from 'drizzle-orm';
import { db, schema } from '../db.js';
import {
  getRedisConnection,
  REMINDER_TRIGGER_QUEUE_NAME,
  SILENT_SYNC_QUEUE_NAME,
  expoReceiptAuditQueue,
  type ReminderTriggerJobData,
  type SilentSyncJobData,
} from '../queues/index.js';

const { userDevices } = schema;

export const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true,
});

/**
 * Dispatches an array of Expo push messages in optimal chunks,
 * immediately prunes dead tokens on synchronous errors,
 * and enqueues successful ticket IDs for a 15-minute delayed receipt audit.
 */
export async function dispatchPushNotificationsAndEnqueueAudit(
  messages: ExpoPushMessage[]
): Promise<{ ticketCount: number; errorCount: number }> {
  if (messages.length === 0) {
    return { ticketCount: 0, errorCount: 0 };
  }

  const chunks = expo.chunkPushNotifications(messages);
  const ticketIds: string[] = [];
  const tokenMap: Record<string, string> = {};
  let errorCount = 0;

  for (const chunk of chunks) {
    try {
      const ticketChunk: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);

      for (let i = 0; i < ticketChunk.length; i++) {
        const ticket = ticketChunk[i];
        const token = Array.isArray(chunk[i]?.to)
          ? (chunk[i]?.to as string[])[0]
          : (chunk[i]?.to as string);

        if (!ticket || !token) continue;

        if (ticket.status === 'ok') {
          ticketIds.push(ticket.id);
          tokenMap[ticket.id] = token;
        } else if (ticket.status === 'error') {
          errorCount++;
          console.warn(`[ExpoPushWorker] Push ticket error for token ${token}:`, ticket.message);

          // If synchronous ticket indicates DeviceNotRegistered, immediately purge from DB
          if (ticket.details?.error === 'DeviceNotRegistered') {
            console.log(`[ExpoPushWorker] Immediate DeviceNotRegistered error: purging ${token}`);
            await db.delete(userDevices).where(eq(userDevices.expoPushToken, token));
          }
        }
      }
    } catch (chunkError) {
      console.error('[ExpoPushWorker] Error sending chunk of push notifications:', chunkError);
      errorCount += chunk.length;
    }
  }

  // Enqueue delayed receipt audit (15-minute delay) to inspect asynchronous APNs/FCM delivery
  if (ticketIds.length > 0) {
    await expoReceiptAuditQueue.add(
      'audit-receipts',
      { ticketIds, tokenMap },
      {
        delay: 15 * 60 * 1000, // 15 minutes in milliseconds
        removeOnComplete: true,
      }
    );
    console.log(
      `[ExpoPushWorker] Enqueued 15-minute receipt audit for ${ticketIds.length} tickets.`
    );
  }

  return { ticketCount: ticketIds.length, errorCount };
}

/**
 * Worker consuming `reminder-trigger-queue`:
 * Dispatches high-priority reminder alert notifications to user's registered devices.
 */
export function createReminderTriggerWorker(): Worker<ReminderTriggerJobData> {
  const worker = new Worker<ReminderTriggerJobData>(
    REMINDER_TRIGGER_QUEUE_NAME,
    async (job) => {
      const { reminderId, userId, title, notes } = job.data;
      console.log(`[ReminderTriggerWorker] Processing reminder trigger: ${reminderId} for user ${userId}`);

      // Query all registered devices for the user
      const devices = await db
        .select()
        .from(userDevices)
        .where(eq(userDevices.userId, userId));

      const validTokens = devices
        .map((d) => d.expoPushToken)
        .filter((token) => Expo.isExpoPushToken(token));

      if (validTokens.length === 0) {
        console.log(`[ReminderTriggerWorker] No valid push tokens found for user ${userId}.`);
        return;
      }

      const messages: ExpoPushMessage[] = validTokens.map((token) => ({
        to: token,
        sound: 'default',
        title: title,
        body: notes || 'You have an active reminder',
        data: { reminderId },
        priority: 'high',
        channelId: 'reminders',
      }));

      const result = await dispatchPushNotificationsAndEnqueueAudit(messages);
      console.log(
        `[ReminderTriggerWorker] Dispatched reminder ${reminderId}: ${result.ticketCount} ok, ${result.errorCount} errors.`
      );
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ReminderTriggerWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}

/**
 * Worker consuming `silent-sync-queue`:
 * Dispatches background `_contentAvailable: true` data pushes to peer devices
 * so they perform background delta sync without alerting the user with sounds/banners.
 */
export function createSilentSyncWorker(): Worker<SilentSyncJobData> {
  const worker = new Worker<SilentSyncJobData>(
    SILENT_SYNC_QUEUE_NAME,
    async (job) => {
      const { userId, excludedDeviceId, mutatedReminderIds, timestamp } = job.data;
      console.log(`[SilentSyncWorker] Dispatching silent push for user ${userId}`);

      // Query peer devices (excluding device that triggered the sync)
      const conditions = [eq(userDevices.userId, userId)];
      if (excludedDeviceId) {
        conditions.push(ne(userDevices.id, excludedDeviceId));
      }

      const peerDevices = await db
        .select()
        .from(userDevices)
        .where(and(...conditions));

      const validTokens = peerDevices
        .map((d) => d.expoPushToken)
        .filter((token) => Expo.isExpoPushToken(token));

      if (validTokens.length === 0) {
        console.log(`[SilentSyncWorker] No peer devices to notify for user ${userId}.`);
        return;
      }

      // Format background silent push message (_contentAvailable wakes iOS/Android app)
      const messages: ExpoPushMessage[] = validTokens.map((token) => ({
        to: token,
        _contentAvailable: true,
        priority: 'normal',
        data: {
          type: 'SILENT_SYNC',
          mutatedReminderIds: mutatedReminderIds ?? [],
          timestamp,
        },
      }));

      const result = await dispatchPushNotificationsAndEnqueueAudit(messages);
      console.log(
        `[SilentSyncWorker] Sent silent sync push to ${result.ticketCount} peer devices.`
      );
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[SilentSyncWorker] Job ${job?.id} failed:`, err);
  });

  return worker;
}
