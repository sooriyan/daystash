import { describe, it, expect } from 'vitest';
import { Expo } from 'expo-server-sdk';

describe('Expo Push Worker - Message Chunking & Token Validation', () => {
  it('correctly filters valid Expo push tokens', () => {
    const tokens = [
      'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]',
      'invalid-token-format',
      '',
      'null',
    ];

    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    expect(valid).toHaveLength(2);
    expect(valid).toContain('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]');
    expect(valid).toContain('ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]');
  });

  it('chunks large batches of notifications into sub-100 batches', () => {
    const expo = new Expo();
    const messages = Array.from({ length: 250 }, (_, i) => ({
      to: `ExponentPushToken[token_${i}_padding_padding]`,
      sound: 'default' as const,
      title: `Reminder ${i}`,
      body: 'Time to check in',
    }));

    const chunks = expo.chunkPushNotifications(messages);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(100);
    });
  });
});
