import 'dotenv/config';
import { pool } from './db.js';
import {
  getRedisConnection,
  reminderTriggerQueue,
  silentSyncQueue,
  expoReceiptAuditQueue,
} from './queues/index.js';
import {
  setupHorizonPollerCron,
  pollHorizonOnce,
  createHorizonPollerWorker,
  horizonPollerQueue,
} from './workers/horizonPoller.js';
import {
  createReminderTriggerWorker,
  createSilentSyncWorker,
} from './workers/expoPushWorker.js';
import { createReceiptAuditWorker } from './workers/receiptAuditWorker.js';

console.log('====================================================');
console.log('🚀 Starting DayStash Background Worker Service');
console.log('====================================================');

async function bootstrap() {
  try {
    // 1. Initialize repeatable 5-minute cron for horizon polling
    await setupHorizonPollerCron();

    // 2. Perform initial immediate horizon scan on service boot
    console.log('[Worker Service] Executing startup horizon scan...');
    const initialStats = await pollHorizonOnce();
    console.log(
      `[Worker Service] Startup scan: ${initialStats.polledCount} due, ${initialStats.enqueuedCount} enqueued, ${initialStats.recurrenceAdvancedCount} advanced.`
    );

    // 3. Start BullMQ background workers
    const horizonPollerWorker = createHorizonPollerWorker();
    const reminderTriggerWorker = createReminderTriggerWorker();
    const silentSyncWorker = createSilentSyncWorker();
    const receiptAuditWorker = createReceiptAuditWorker();

    console.log('✅ All BullMQ workers successfully initialized and listening:');
    console.log('  - horizon-poller-queue (cron: */5 * * * *)');
    console.log('  - reminder-trigger-queue (delayed millisecond execution)');
    console.log('  - silent-sync-queue (peer device data wake)');
    console.log('  - expo-receipt-audit-queue (15-min delivery audit)');

    // 4. Register production-hardened graceful shutdown handlers
    let isShuttingDown = false;

    const handleShutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      console.log(`\n[Worker Service] ${signal} received. Initiating graceful shutdown...`);

      // Set shutdown timeout safeguard (15 seconds)
      const forceExitTimeout = setTimeout(() => {
        console.error('[Worker Service] Graceful shutdown timed out. Forcing process exit.');
        process.exit(1);
      }, 15000);
      forceExitTimeout.unref();

      try {
        console.log('[Worker Service] Pausing and closing BullMQ workers...');
        await Promise.allSettled([
          horizonPollerWorker.close(),
          reminderTriggerWorker.close(),
          silentSyncWorker.close(),
          receiptAuditWorker.close(),
        ]);

        console.log('[Worker Service] Closing BullMQ queues...');
        await Promise.allSettled([
          horizonPollerQueue.close(),
          reminderTriggerQueue.close(),
          silentSyncQueue.close(),
          expoReceiptAuditQueue.close(),
        ]);

        console.log('[Worker Service] Closing PostgreSQL connection pool...');
        await pool.end();

        console.log('[Worker Service] Closing Redis connection...');
        const redis = getRedisConnection();
        await redis.quit();

        console.log('👋 DayStash Worker Service cleanly stopped. Goodbye!');
        process.exit(0);
      } catch (shutdownError) {
        console.error('[Worker Service] Error during shutdown:', shutdownError);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (error) {
    console.error('[Worker Service] Fatal error during startup:', error);
    process.exit(1);
  }
}

bootstrap();
