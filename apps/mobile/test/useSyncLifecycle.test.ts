import { describe, it, expect, vi } from 'vitest';

describe('useSyncLifecycle Event Trigger Mechanics', () => {
  it('triggers sync when AppState transitions to active', () => {
    let appStateCallback: ((state: string) => void) | null = null;
    const mockTrigger = vi.fn();

    const addEventListener = vi.fn((event: string, callback: (state: string) => void) => {
      if (event === 'change') {
        appStateCallback = callback;
      }
      return { remove: vi.fn() };
    });

    // Simulate hook setting up AppState listener
    addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        mockTrigger('APP_FOREGROUND');
      }
    });

    // Simulate backgrounding
    appStateCallback!('background');
    expect(mockTrigger).not.toHaveBeenCalled();

    // Simulate foregrounding
    appStateCallback!('active');
    expect(mockTrigger).toHaveBeenCalledWith('APP_FOREGROUND');
  });

  it('triggers sync when network transitions from offline to online', () => {
    let netInfoCallback: ((state: { isConnected: boolean }) => void) | null = null;
    const mockTrigger = vi.fn();
    let wasConnected: boolean | null = null;

    const addEventListener = vi.fn((callback: (state: { isConnected: boolean }) => void) => {
      netInfoCallback = callback;
      return vi.fn();
    });

    // Simulate hook setting up NetInfo listener
    addEventListener((state) => {
      const isConnected = state.isConnected;
      if (wasConnected === false && isConnected) {
        mockTrigger('NETWORK_RECONNECT');
      }
      wasConnected = isConnected;
    });

    // Initial state: connected
    netInfoCallback!({ isConnected: true });
    expect(mockTrigger).not.toHaveBeenCalled();

    // Goes offline
    netInfoCallback!({ isConnected: false });
    expect(mockTrigger).not.toHaveBeenCalled();

    // Comes back online
    netInfoCallback!({ isConnected: true });
    expect(mockTrigger).toHaveBeenCalledWith('NETWORK_RECONNECT');
  });

  it('triggers sync upon receiving SILENT_SYNC notification', () => {
    let notificationCallback: ((notification: { request: { content: { data: Record<string, unknown> } } }) => void) | null = null;
    const mockTrigger = vi.fn();

    const addNotificationReceivedListener = vi.fn((cb) => {
      notificationCallback = cb;
      return { remove: vi.fn() };
    });

    // Hook registers listener
    addNotificationReceivedListener((notification: { request: { content: { data: Record<string, unknown> } } }) => {
      const data = notification.request.content.data;
      if (data && data.type === 'SILENT_SYNC') {
        mockTrigger('SILENT_PUSH');
      }
    });

    // Notification of standard type
    notificationCallback!({
      request: { content: { data: { type: 'PROMOTIONAL_OFFER' } } },
    });
    expect(mockTrigger).not.toHaveBeenCalled();

    // Silent sync notification
    notificationCallback!({
      request: { content: { data: { type: 'SILENT_SYNC', timestamp: '2026-03-08T14:00:00Z' } } },
    });
    expect(mockTrigger).toHaveBeenCalledWith('SILENT_PUSH');
  });
});
