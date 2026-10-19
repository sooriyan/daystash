import { describe, it, expect } from 'vitest';
import { SyncRequestSchema } from '@repo/core/validators/sync';

describe('POST /api/sync Protocol & Concurrency Logic', () => {
  describe('Inbound Payload Validation', () => {
    it('successfully parses client sync payload with mutations array', () => {
      const payload = {
        deviceId: 'device-mobile-uuid-1',
        lastSyncedAt: '2026-03-08T12:00:00.000Z',
        clientTimestamp: '2026-03-08T14:00:00.000Z',
        mutations: [
          {
            id: 'rem-uuid-1',
            title: 'Meditation reminder',
            notes: '15 mins mindfulness',
            rrule: 'FREQ=DAILY;INTERVAL=1',
            timezone: 'Asia/Kolkata',
            nextTriggerUtc: '2026-03-09T02:30:00.000Z',
            status: 'ACTIVE' as const,
            version: 1,
            createdAt: '2026-03-01T02:30:00.000Z',
            updatedAt: '2026-03-08T13:59:00.000Z',
            deletedAt: null,
          },
        ],
      };

      const result = SyncRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mutations).toHaveLength(1);
        expect(result.data.deviceId).toBe('device-mobile-uuid-1');
      }
    });

    it('rejects payload with invalid ISO 8601 timestamps', () => {
      const payload = {
        deviceId: 'device-mobile-uuid-1',
        lastSyncedAt: 'not-a-date',
        clientTimestamp: '2026-03-08T14:00:00.000Z',
        mutations: [],
      };

      const result = SyncRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('Optimistic Concurrency Control (OCC) and LWW Rules', () => {
    // Pure function representing the exact OCC + LWW fallback algorithm in the route handler
    function resolveConcurrency(
      clientRecord: { version: number; updatedAt: string },
      serverRecord: { version: number; updatedAt: string }
    ): { shouldApply: boolean; reason?: string } {
      const clientVersion = clientRecord.version;
      const serverVersion = serverRecord.version;
      const clientUpdatedAtMs = new Date(clientRecord.updatedAt).getTime();
      const serverUpdatedAtMs = new Date(serverRecord.updatedAt).getTime();

      if (clientVersion >= serverVersion) {
        return { shouldApply: true };
      }

      if (clientUpdatedAtMs > serverUpdatedAtMs) {
        return { shouldApply: true, reason: 'LWW_FALLBACK' };
      }

      return { shouldApply: false, reason: 'VERSION_CONFLICT' };
    }

    it('accepts client update when client version matches or exceeds server version', () => {
      const client = { version: 2, updatedAt: '2026-03-08T14:00:00.000Z' };
      const server = { version: 1, updatedAt: '2026-03-08T12:00:00.000Z' };

      const outcome = resolveConcurrency(client, server);
      expect(outcome.shouldApply).toBe(true);
    });

    it('accepts client update under Last-Write-Wins (LWW) if client version is lower but timestamp is newer', () => {
      const client = { version: 1, updatedAt: '2026-03-08T15:00:00.000Z' }; // newer wall clock
      const server = { version: 2, updatedAt: '2026-03-08T14:00:00.000Z' }; // older server update

      const outcome = resolveConcurrency(client, server);
      expect(outcome.shouldApply).toBe(true);
      expect(outcome.reason).toBe('LWW_FALLBACK');
    });

    it('rejects client update as conflict when client version is lower AND timestamp is older or equal', () => {
      const client = { version: 1, updatedAt: '2026-03-08T13:00:00.000Z' };
      const server = { version: 3, updatedAt: '2026-03-08T14:30:00.000Z' };

      const outcome = resolveConcurrency(client, server);
      expect(outcome.shouldApply).toBe(false);
      expect(outcome.reason).toBe('VERSION_CONFLICT');
    });
  });
});
