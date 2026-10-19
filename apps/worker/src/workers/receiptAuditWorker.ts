import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db.js';
import { expo } from './expoPushWorker.js';
import {
  getRedisConnection,
  EXPO_RECEIPT_AUDIT_QUEUE_NAME,
  type ReceiptAuditJobData,
} from '../queues/index.js';

const { userDevices } = schema;

export interface AuditResult {
  auditedCount: number;
  prunedCount: number;
}

/**
 * Audits a batch of Expo Push Ticket IDs by fetching their delivery receipts from Expo's servers.
 * If any receipt status is 'error' with 'DeviceNotRegistered', the defunct push token
 * is deleted from PostgreSQL `user_devices` to keep the device registry clean and prevent wasted sends.
 */
export async function auditReceipts(data: ReceiptAuditJobData): Promise<AuditResult> {
  const { ticketIds, tokenMap } = data;

  if (!ticketIds || ticketIds.length === 0) {
    return { auditedCount: 0, prunedCount: 0 };
  }

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(ticketIds);
  let prunedCount = 0;

  for (const chunk of receiptIdChunks) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

      for (const [receiptId, receipt] of Object.entries(receipts)) {
        if (receipt.status === 'ok') {
          // Message was successfully handed off to APNs/FCM
          continue;
        }

        if (receipt.status === 'error') {
          console.warn(
            `[ReceiptAuditWorker] Delivery failure for receipt ${receiptId}:`,
            receipt.message,
            receipt.details
          );

          if (receipt.details?.error === 'DeviceNotRegistered') {
            const tokenToDelete = tokenMap[receiptId];

            if (tokenToDelete) {
              console.log(
                `[ReceiptAuditWorker] DeviceNotRegistered confirmed for token ${tokenToDelete}. Pruning from PostgreSQL user_devices.`
              );

              await db
                .delete(userDevices)
                .where(eq(userDevices.expoPushToken, tokenToDelete));

              prunedCount++;
            }
          }
        }
      }
    } catch (chunkError) {
      console.error('[ReceiptAuditWorker] Error fetching receipt chunk:', chunkError);
    }
  }

  return {
    auditedCount: ticketIds.length,
    prunedCount,
  };
}

/**
 * BullMQ Worker consuming `expo-receipt-audit-queue`.
 */
export function createReceiptAuditWorker(): Worker<ReceiptAuditJobData> {
  const worker = new Worker<ReceiptAuditJobData>(
    EXPO_RECEIPT_AUDIT_QUEUE_NAME,
    async (job) => {
      console.log(`[ReceiptAuditWorker] Auditing ${job.data.ticketIds.length} push receipts for job ${job.id}...`);
      const result = await auditReceipts(job.data);
      console.log(
        `[ReceiptAuditWorker] Audit complete: ${result.auditedCount} audited, ${result.prunedCount} defunct tokens pruned.`
      );
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ReceiptAuditWorker] Receipt audit job ${job?.id} failed:`, err);
  });

  return worker;
}
