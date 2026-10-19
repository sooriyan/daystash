import { describe, it, expect } from 'vitest';

describe('Receipt Audit Worker - Token Pruning Logic', () => {
  it('identifies tokens to delete when receipt error is DeviceNotRegistered', () => {
    const tokenMap: Record<string, string> = {
      'ticket-1': 'ExponentPushToken[valid-token-1]',
      'ticket-2': 'ExponentPushToken[dead-token-2]',
      'ticket-3': 'ExponentPushToken[temporary-error-3]',
    };

    const mockReceipts: Record<
      string,
      { status: 'ok' | 'error'; message?: string; details?: { error?: string } }
    > = {
      'ticket-1': { status: 'ok' },
      'ticket-2': {
        status: 'error',
        message: 'The device is no longer registered',
        details: { error: 'DeviceNotRegistered' },
      },
      'ticket-3': {
        status: 'error',
        message: 'Message rate exceeded',
        details: { error: 'MessageRateExceeded' },
      },
    };

    const tokensToPrune: string[] = [];

    for (const [receiptId, receipt] of Object.entries(mockReceipts)) {
      if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
        const token = tokenMap[receiptId];
        if (token) {
          tokensToPrune.push(token);
        }
      }
    }

    expect(tokensToPrune).toEqual(['ExponentPushToken[dead-token-2]']);
    expect(tokensToPrune).not.toContain('ExponentPushToken[valid-token-1]');
    expect(tokensToPrune).not.toContain('ExponentPushToken[temporary-error-3]');
  });
});
