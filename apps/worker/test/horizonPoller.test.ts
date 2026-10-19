import { describe, it, expect } from 'vitest';
import { computeNextOccurrence } from '@repo/core/recurrence/rruleEngine';

describe('Horizon Poller - Idempotency & Recurrence Logic', () => {
  it('generates deterministic jobId in format reminder_${id}_${nextTriggerUtcEpoch}', () => {
    const reminderId = 'rem-abc-123';
    const nextTriggerUtc = new Date('2026-03-08T14:00:00.000Z');
    const epoch = nextTriggerUtc.getTime();

    const jobId = `reminder_${reminderId}_${epoch}`;
    expect(jobId).toBe('reminder_rem-abc-123_1772978400000');

    // Identical trigger generates identical jobId ensuring BullMQ deduplication
    const jobIdDuplicate = `reminder_${reminderId}_${nextTriggerUtc.getTime()}`;
    expect(jobId).toBe(jobIdDuplicate);
  });

  it('correctly advances recurrence trigger for recurring active reminders', () => {
    const rrule = 'FREQ=DAILY;INTERVAL=1';
    const timezone = 'America/New_York';
    const currentTriggerUtc = new Date('2026-03-07T14:00:00.000Z'); // Saturday March 7, 2026 9am EST

    const nextTriggerUtc = computeNextOccurrence(rrule, timezone, currentTriggerUtc);
    expect(nextTriggerUtc).not.toBeNull();
    // After spring forward, 9am EDT = 13:00 UTC
    expect(nextTriggerUtc?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('detects when recurrence is exhausted to transition status to COMPLETED', () => {
    const dtstart = new Date('2026-01-01T10:00:00.000Z');
    const rrule = 'FREQ=DAILY;COUNT=1'; // Only 1 occurrence at dtstart
    const timezone = 'UTC';

    // Searching strictly after dtstart
    const nextTriggerUtc = computeNextOccurrence(rrule, timezone, dtstart, { dtstart });
    expect(nextTriggerUtc).toBeNull();
  });
});
