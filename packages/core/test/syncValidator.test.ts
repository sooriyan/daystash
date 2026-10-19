import { describe, it, expect } from 'vitest';
import {
  SyncRequestSchema,
  SyncResponseSchema,
  ReminderSyncMutationSchema,
  isValidTimezone,
} from '../src/validators/sync.js';

describe('Sync Validator (Zod Schema Validation)', () => {
  describe('Timezone validation', () => {
    it('accepts valid IANA timezones', () => {
      expect(isValidTimezone('Asia/Kolkata')).toBe(true);
      expect(isValidTimezone('America/New_York')).toBe(true);
      expect(isValidTimezone('Europe/London')).toBe(true);
      expect(isValidTimezone('UTC')).toBe(true);
    });

    it('rejects invalid or gibberish timezones', () => {
      expect(isValidTimezone('Invalid/Timezone')).toBe(false);
      expect(isValidTimezone('')).toBe(false);
      expect(isValidTimezone('GMT+5')).toBe(false);
    });
  });

  describe('SyncRequestSchema', () => {
    it('parses valid client sync request with dirty mutations', () => {
      const payload = {
        deviceId: 'device-iphone-15-pro-abc',
        lastSyncedAt: '2026-03-08T10:00:00.000Z',
        clientTimestamp: '2026-03-08T14:30:00.000Z',
        mutations: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Take daily medication',
            notes: 'Take with full glass of water',
            rrule: 'FREQ=DAILY;INTERVAL=1',
            timezone: 'America/New_York',
            nextTriggerUtc: '2026-03-09T13:00:00.000Z',
            status: 'ACTIVE' as const,
            version: 2,
            createdAt: '2026-03-01T14:00:00.000Z',
            updatedAt: '2026-03-08T14:25:00.000Z',
            deletedAt: null,
          },
        ],
      };

      const parsed = SyncRequestSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.deviceId).toBe('device-iphone-15-pro-abc');
        expect(parsed.data.mutations).toHaveLength(1);
        expect(parsed.data.mutations[0]?.title).toBe('Take daily medication');
      }
    });

    it('allows initial sync with null lastSyncedAt and empty mutations', () => {
      const payload = {
        deviceId: 'device-pixel-9-xyz',
        lastSyncedAt: null,
        clientTimestamp: '2026-03-08T14:30:00.000Z',
        mutations: [],
      };

      const parsed = SyncRequestSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.lastSyncedAt).toBeNull();
        expect(parsed.data.mutations).toEqual([]);
      }
    });

    it('rejects client mutation with invalid timezone', () => {
      const payload = {
        id: 'rem-123',
        title: 'Call mom',
        timezone: 'Fantasy/Atlantis',
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:00:00.000Z',
      };

      const parsed = ReminderSyncMutationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain('valid IANA timezone');
      }
    });

    it('rejects invalid status', () => {
      const payload = {
        id: 'rem-123',
        title: 'Call mom',
        timezone: 'Asia/Kolkata',
        status: 'DONE_INVALID',
        version: 1,
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:00:00.000Z',
      };

      const parsed = ReminderSyncMutationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
    });
  });

  describe('SyncResponseSchema', () => {
    it('parses server response with deltas, applied IDs, and conflict objects', () => {
      const response = {
        syncedAt: '2026-03-08T14:30:01.000Z',
        appliedRecordIds: ['550e8400-e29b-41d4-a716-446655440000'],
        conflicts: [
          {
            id: 'conflicted-uuid-1',
            reason: 'VERSION_CONFLICT' as const,
            message: 'Server record version (5) is higher than client version (3)',
            serverRecord: {
              id: 'conflicted-uuid-1',
              userId: 'user-456',
              title: 'Updated from web dashboard',
              notes: null,
              rrule: null,
              timezone: 'Asia/Kolkata',
              nextTriggerUtc: '2026-03-10T03:30:00.000Z',
              status: 'ACTIVE' as const,
              version: 5,
              createdAt: '2026-03-01T03:30:00.000Z',
              updatedAt: '2026-03-08T12:00:00.000Z',
              deletedAt: null,
            },
          },
        ],
        serverDeltas: [
          {
            id: 'server-delta-uuid-99',
            userId: 'user-456',
            title: 'Dentist appointment',
            notes: 'Dr. Smith clinic',
            rrule: null,
            timezone: 'Asia/Kolkata',
            nextTriggerUtc: '2026-03-15T09:00:00.000Z',
            status: 'ACTIVE' as const,
            version: 1,
            createdAt: '2026-03-08T13:00:00.000Z',
            updatedAt: '2026-03-08T13:00:00.000Z',
            deletedAt: null,
          },
        ],
      };

      const parsed = SyncResponseSchema.safeParse(response);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.appliedRecordIds).toContain('550e8400-e29b-41d4-a716-446655440000');
        expect(parsed.data.conflicts).toHaveLength(1);
        expect(parsed.data.serverDeltas).toHaveLength(1);
      }
    });
  });
});
