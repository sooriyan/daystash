import { describe, it, expect } from 'vitest';
import {
  computeNextOccurrence,
  computeNextOccurrences,
  computeOccurrencesBetween,
  validateRRule,
  formatRRuleHumanReadable,
} from '../src/recurrence/rruleEngine.js';

describe('Recurrence Engine (DST-Safe & Timezone-Aware)', () => {
  describe('US DST Transitions (America/New_York)', () => {
    it('correctly shifts UTC offset during US Spring Forward (EST UTC-5 -> EDT UTC-4 in March 2026)', () => {
      // In 2026, US DST starts on Sunday, March 8, 2026.
      // Saturday March 7, 2026 at 09:00 EST = 14:00:00.000Z
      const saturdayEstUtc = new Date('2026-03-07T14:00:00.000Z');

      const rrule = 'FREQ=DAILY;INTERVAL=1';
      const timezone = 'America/New_York';

      // Compute next day (Sunday March 8, 2026 - transition day)
      const sundayOccurrence = computeNextOccurrence(rrule, timezone, saturdayEstUtc);
      expect(sundayOccurrence).not.toBeNull();
      // On March 8, 09:00 EDT = 13:00:00 UTC
      expect(sundayOccurrence?.toISOString()).toBe('2026-03-08T13:00:00.000Z');

      // Compute next day (Monday March 9, 2026 - first full EDT weekday)
      const mondayOccurrence = computeNextOccurrence(rrule, timezone, sundayOccurrence!);
      expect(mondayOccurrence).not.toBeNull();
      // On March 9, 09:00 EDT = 13:00:00 UTC (NOT 14:00:00Z!)
      expect(mondayOccurrence?.toISOString()).toBe('2026-03-09T13:00:00.000Z');
    });

    it('correctly shifts UTC offset during US Fall Back (EDT UTC-4 -> EST UTC-5 in November 2026)', () => {
      // In 2026, US DST ends on Sunday, November 1, 2026.
      // Saturday October 31, 2026 at 09:00 EDT = 13:00:00.000Z
      const saturdayEdtUtc = new Date('2026-10-31T13:00:00.000Z');

      const rrule = 'FREQ=DAILY;INTERVAL=1';
      const timezone = 'America/New_York';

      // Compute next day (Sunday November 1, 2026 - transition day back to standard time)
      const sundayOccurrence = computeNextOccurrence(rrule, timezone, saturdayEdtUtc);
      expect(sundayOccurrence).not.toBeNull();
      // On November 1, 09:00 EST = 14:00:00 UTC
      expect(sundayOccurrence?.toISOString()).toBe('2026-11-01T14:00:00.000Z');

      // Compute next day (Monday November 2, 2026)
      const mondayOccurrence = computeNextOccurrence(rrule, timezone, sundayOccurrence!);
      expect(mondayOccurrence).not.toBeNull();
      // On November 2, 09:00 EST = 14:00:00 UTC (NOT 13:00:00Z!)
      expect(mondayOccurrence?.toISOString()).toBe('2026-11-02T14:00:00.000Z');
    });
  });

  describe('Fixed-Offset Timezones (Asia/Kolkata)', () => {
    it('maintains fixed UTC+05:30 offset consistently across all seasons', () => {
      // 09:00:00 IST is strictly 03:30:00.000Z every day
      const startUtc = new Date('2026-03-01T03:30:00.000Z');
      const rrule = 'FREQ=DAILY;INTERVAL=1';
      const timezone = 'Asia/Kolkata';

      const next1 = computeNextOccurrence(rrule, timezone, startUtc);
      expect(next1?.toISOString()).toBe('2026-03-02T03:30:00.000Z');

      // Check during summer
      const summerUtc = new Date('2026-07-15T03:30:00.000Z');
      const nextSummer = computeNextOccurrence(rrule, timezone, summerUtc);
      expect(nextSummer?.toISOString()).toBe('2026-07-16T03:30:00.000Z');
    });
  });

  describe('Europe/London (GMT/BST)', () => {
    it('handles GMT (UTC+0) to BST (UTC+1) transition at end of March 2026', () => {
      // Sunday March 29, 2026 is London spring forward.
      // Saturday March 28 at 10:00 GMT = 10:00:00.000Z
      const saturdayGmt = new Date('2026-03-28T10:00:00.000Z');
      const rrule = 'FREQ=DAILY;INTERVAL=1';
      const timezone = 'Europe/London';

      const sundayBst = computeNextOccurrence(rrule, timezone, saturdayGmt);
      expect(sundayBst?.toISOString()).toBe('2026-03-29T09:00:00.000Z'); // 10:00 BST = 09:00 UTC

      const mondayBst = computeNextOccurrence(rrule, timezone, sundayBst!);
      expect(mondayBst?.toISOString()).toBe('2026-03-30T09:00:00.000Z');
    });
  });

  describe('Multi-Occurrence and Bounded Recurrences', () => {
    it('computes next N occurrences spanning DST transition', () => {
      const ref = new Date('2026-03-06T14:00:00.000Z'); // 09:00 EST
      const rrule = 'FREQ=DAILY;INTERVAL=1';
      const timezone = 'America/New_York';

      const list = computeNextOccurrences(rrule, timezone, ref, 5);
      expect(list).toHaveLength(5);
      expect(list[0]?.toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
      expect(list[1]?.toISOString()).toBe('2026-03-08T13:00:00.000Z'); // EDT
      expect(list[2]?.toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
      expect(list[3]?.toISOString()).toBe('2026-03-10T13:00:00.000Z'); // EDT
      expect(list[4]?.toISOString()).toBe('2026-03-11T13:00:00.000Z'); // EDT
    });

    it('computes occurrences between two dates', () => {
      const start = new Date('2026-03-05T00:00:00.000Z');
      const end = new Date('2026-03-10T23:59:59.000Z');
      const rrule = 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0;BYSECOND=0';
      const timezone = 'America/New_York';

      const results = computeOccurrencesBetween(rrule, timezone, start, end);
      expect(results.length).toBeGreaterThan(0);
      results.forEach((date) => {
        expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
      });
    });

    it('returns null when COUNT or UNTIL is exhausted', () => {
      const dtstart = new Date('2026-01-01T10:00:00.000Z');
      const rrule = 'FREQ=DAILY;COUNT=2';
      const timezone = 'UTC';

      // 1st occurrence after dtstart is Jan 2 (with dtstart Jan 1)
      const occ1 = computeNextOccurrence(rrule, timezone, dtstart, { dtstart });
      expect(occ1?.toISOString()).toBe('2026-01-02T10:00:00.000Z');

      // 2nd occurrence check: with COUNT=2, occurrences are Jan 1 and Jan 2.
      // Searching strictly after Jan 2 should yield null.
      const occ2 = computeNextOccurrence(rrule, timezone, occ1!, { dtstart });
      expect(occ2).toBeNull();

      // Test UNTIL clause embedded in RRULE string
      const untilRrule = 'DTSTART:20260101T100000Z\nRRULE:FREQ=DAILY;UNTIL=20260102T100000Z';
      const occAfterUntil = computeNextOccurrence(untilRrule, timezone, occ1!);
      expect(occAfterUntil).toBeNull();
    });
  });

  describe('Validation and Formatting', () => {
    it('validates correct and malformed RRULE strings', () => {
      expect(validateRRule('FREQ=DAILY;INTERVAL=1').isValid).toBe(true);
      expect(validateRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE').isValid).toBe(true);
      expect(validateRRule('INVALID_GARBAGE').isValid).toBe(false);
    });

    it('throws TypeError on invalid IANA timezones', () => {
      expect(() => {
        computeNextOccurrence('FREQ=DAILY', 'Mars/Olympus_Mons', new Date());
      }).toThrowError(/Invalid IANA timezone identifier/);
    });

    it('formats human readable rule text', () => {
      const text = formatRRuleHumanReadable('FREQ=DAILY;INTERVAL=1');
      expect(text.toLowerCase()).toContain('day');
    });
  });
});
