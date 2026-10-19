import { Queue, Worker } from 'bullmq';
import { and, eq, isNull, isNotNull, lte, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db.js';
import {
  getRedisConnection,
  reminderTriggerQueue,
  type ReminderTriggerJobData,
} from '../queues/index.js';
import { computeNextOccurrence } from '@repo/core/recurrence/rruleEngine';

const { reminders } = schema;

export const HORIZON_POLLER_QUEUE_NAME = 'horizon-poller-queue';

export interface HorizonPollStats {
  polledCount: number;
  enqueuedCount: number;
  recurrenceAdvancedCount: number;
  completedRecurrenceCount: number;
}

/**
 * Executes a single scan of the 10-minute upcoming horizon:
 * 1. Queries PostgreSQL for ACTIVE reminders due in the next 10 minutes.
 * 2. Enqueues each into reminder-trigger-queue with exact millisecond delay
 *    and deterministic jobId = reminder_${id}_${nextTriggerUtcEpoch} for idempotency.
 * 3. Calculates and updates the next recurrence occurrence in PostgreSQL if rrule is present.
 */
export async function pollHorizonOnce(): Promise<HorizonPollStats> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 10 * 60 * 1000);
  const graceWindowStart = new Date(now.getTime() - 60 * 1000); // 1-minute grace for clock drift

  const dueReminders = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.status, 'ACTIVE'),
        isNull(reminders.deletedAt),
        isNotNull(reminders.nextTriggerUtc),
        lte(reminders.nextTriggerUtc, horizonEnd),
        gte(reminders.nextTriggerUtc, graceWindowStart)
      )
    );

  let enqueuedCount = 0;
  let recurrenceAdvancedCount = 0;
  let completedRecurrenceCount = 0;

  for (const reminder of dueReminders) {
    if (!reminder.nextTriggerUtc) continue;

    const triggerEpoch = reminder.nextTriggerUtc.getTime();
    const delay = Math.max(0, triggerEpoch - Date.now());
    const jobId = `reminder_${reminder.id}_${triggerEpoch}`;

    const jobData: ReminderTriggerJobData = {
      reminderId: reminder.id,
      userId: reminder.userId,
      title: reminder.title,
      notes: reminder.notes,
      triggerUtcEpoch: triggerEpoch,
    };

    // Idempotent enqueue: BullMQ will discard duplicate job if jobId is already present
    await reminderTriggerQueue.add('trigger-reminder', jobData, {
      jobId,
      delay,
    });
    enqueuedCount++;

    // Calculate and advance recurrence in PostgreSQL if an rrule is present
    if (reminder.rrule && reminder.rrule.trim().length > 0) {
      const nextOccurrenceUtc = computeNextOccurrence(
        reminder.rrule,
        reminder.timezone,
        reminder.nextTriggerUtc
      );

      if (nextOccurrenceUtc) {
        // Advance to next trigger in PostgreSQL
        await db
          .update(reminders)
          .set({
            nextTriggerUtc: nextOccurrenceUtc,
            version: sql`${reminders.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(reminders.id, reminder.id));
        recurrenceAdvancedCount++;
      } else {
        // No further occurrences (COUNT or UNTIL exhausted) -> mark COMPLETED
        await db
          .update(reminders)
          .set({
            status: 'COMPLETED',
            version: sql`${reminders.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(reminders.id, reminder.id));
        completedRecurrenceCount++;
      }
    }
  }

  return {
    polledCount: dueReminders.length,
    enqueuedCount,
    recurrenceAdvancedCount,
    completedRecurrenceCount,
  };
}

/**
 * Queue that manages repeatable cron execution for the horizon poller.
 */
export const horizonPollerQueue = new Queue(HORIZON_POLLER_QUEUE_NAME, {
  connection: getRedisConnection(),
});

/**
 * Initializes the repeatable 5-minute cron job for horizon polling.
 */
export async function setupHorizonPollerCron(): Promise<void> {
  // Clear any existing repeatable jobs to prevent duplicates across restarts
  const repeatableJobs = await horizonPollerQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await horizonPollerQueue.removeRepeatableByKey(job.key);
  }

  // Register repeatable job running every 5 minutes (cron: '*/5 * * * *')
  await horizonPollerQueue.add(
    'poll-horizon',
    {},
    {
      repeat: {
        pattern: '*/5 * * * *',
      },
    }
  );

  console.log('[HorizonPoller] Registered 5-minute repeatable cron job.');
}

/**
 * BullMQ Worker executing the horizon poller cron job.
 */
export function createHorizonPollerWorker(): Worker {
  const worker = new Worker(
    HORIZON_POLLER_QUEUE_NAME,
    async () => {
      console.log('[HorizonPoller] Scanning 10-minute upcoming horizon...');
      const stats = await pollHorizonOnce();
      console.log(
        `[HorizonPoller] Scan complete: ${stats.polledCount} due, ${stats.enqueuedCount} enqueued, ${stats.recurrenceAdvancedCount} recurrences advanced.`
      );
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[HorizonPoller] Cron job ${job?.id} failed:`, err);
  });

  return worker;
}
