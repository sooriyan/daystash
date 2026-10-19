import { describe, it, expect } from 'vitest';
import { DeviceRegisterInputSchema } from '../src/lib/validators/device.js';
import { extractAuthUserId } from '../src/lib/auth.js';

describe('POST /api/devices/register Validation & Auth', () => {
  describe('DeviceRegisterInputSchema', () => {
    it('accepts standard ExponentPushToken format', () => {
      const payload = {
        expoPushToken: 'ExponentPushToken[xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx]',
        platform: 'ios' as const,
      };
      const result = DeviceRegisterInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts alternative ExpoPushToken format and hex tokens', () => {
      const payload = {
        expoPushToken: 'ExpoPushToken[abc123DEF456_ghi789]',
        platform: 'android' as const,
      };
      const result = DeviceRegisterInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects invalid or blank push tokens', () => {
      const payload = {
        expoPushToken: 'not-a-token',
        platform: 'web' as const,
      };
      const result = DeviceRegisterInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Invalid Expo push token format');
      }
    });

    it('rejects unsupported platforms', () => {
      const payload = {
        expoPushToken: 'ExponentPushToken[1234567890abcdef]',
        platform: 'windows_desktop',
      };
      const result = DeviceRegisterInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('extractAuthUserId', () => {
    it('extracts user ID from x-user-id header', () => {
      const request = new Request('http://localhost:3000/api/devices/register', {
        headers: {
          'x-user-id': 'user-uuid-12345',
        },
      });
      expect(extractAuthUserId(request)).toBe('user-uuid-12345');
    });

    it('extracts user ID from Bearer token', () => {
      const request = new Request('http://localhost:3000/api/devices/register', {
        headers: {
          authorization: 'Bearer user-session-token-999',
        },
      });
      expect(extractAuthUserId(request)).toBe('user-session-token-999');
    });

    it('returns null when no auth header is present', () => {
      const request = new Request('http://localhost:3000/api/devices/register');
      expect(extractAuthUserId(request)).toBeNull();
    });
  });
});
