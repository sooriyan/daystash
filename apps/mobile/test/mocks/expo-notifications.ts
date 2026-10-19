export const SchedulableTriggerInputTypes = {
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  YEARLY: 'yearly',
} as const;

export interface Notification {
  request: {
    content: {
      data?: Record<string, unknown>;
      title?: string | null;
      body?: string | null;
    };
  };
}

export const scheduleNotificationAsync = async () => 'mock-notification-id-123';
export const cancelScheduledNotificationAsync = async () => {};
export const addNotificationReceivedListener = () => ({ remove: () => {} });
