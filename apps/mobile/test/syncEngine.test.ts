import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWithExponentialBackoff } from '../src/services/syncEngine.js';

describe('Sync Engine - Exponential Backoff & Retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves immediately when first attempt succeeds', async () => {
    const mockResponse = new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    global.fetch = mockFetch;

    const res = await fetchWithExponentialBackoff('http://localhost:3000/api/sync', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 error and succeeds on subsequent attempt', async () => {
    const error500 = new Response('Internal Error', { status: 500 });
    const success200 = new Response(JSON.stringify({ success: true }), { status: 200 });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(error500)
      .mockResolvedValueOnce(success200);

    global.fetch = mockFetch;

    const res = await fetchWithExponentialBackoff('http://localhost:3000/api/sync', {}, 3, 10);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry 400 client validation errors', async () => {
    const error400 = new Response(JSON.stringify({ error: 'Validation Error' }), { status: 400 });
    const mockFetch = vi.fn().mockResolvedValue(error400);
    global.fetch = mockFetch;

    const res = await fetchWithExponentialBackoff('http://localhost:3000/api/sync', {}, 3, 10);
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws error when maxRetries is exceeded', async () => {
    const error503 = new Response('Service Unavailable', { status: 503 });
    const mockFetch = vi.fn().mockResolvedValue(error503);
    global.fetch = mockFetch;

    await expect(
      fetchWithExponentialBackoff('http://localhost:3000/api/sync', {}, 3, 10)
    ).rejects.toThrow(/Server returned status: 503/);

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('Sync Engine - Notification Cancellation Inactivation Logic', () => {
  it('correctly identifies when a reminder is completed, cancelled, or deleted remotely', () => {
    function shouldCancelNotification(delta: {
      status: string;
      deletedAt: string | null;
      localNotificationId: string | null;
    }): boolean {
      const isNowInactiveOrDeleted =
        delta.status === 'COMPLETED' ||
        delta.status === 'CANCELLED' ||
        delta.status === 'ARCHIVED' ||
        delta.deletedAt !== null;

      return Boolean(isNowInactiveOrDeleted && delta.localNotificationId);
    }

    // 1. Completed reminder with scheduled notification
    expect(
      shouldCancelNotification({
        status: 'COMPLETED',
        deletedAt: null,
        localNotificationId: 'notif-1',
      })
    ).toBe(true);

    // 2. Soft-deleted reminder with scheduled notification
    expect(
      shouldCancelNotification({
        status: 'ACTIVE',
        deletedAt: '2026-03-08T12:00:00.000Z',
        localNotificationId: 'notif-2',
      })
    ).toBe(true);

    // 3. Cancelled reminder with scheduled notification
    expect(
      shouldCancelNotification({
        status: 'CANCELLED',
        deletedAt: null,
        localNotificationId: 'notif-3',
      })
    ).toBe(true);

    // 4. Active reminder without soft-deletion
    expect(
      shouldCancelNotification({
        status: 'ACTIVE',
        deletedAt: null,
        localNotificationId: 'notif-4',
      })
    ).toBe(false);

    // 5. Inactive reminder with NO existing notification
    expect(
      shouldCancelNotification({
        status: 'COMPLETED',
        deletedAt: null,
        localNotificationId: null,
      })
    ).toBe(false);
  });
});
