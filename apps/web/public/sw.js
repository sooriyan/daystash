/**
 * DayStash Browser Service Worker
 * Handles native background Web Push notifications and notificationclick actions.
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push Event Listener:
 * Displays rich desktop notifications with "Complete" and "Snooze 10m" action buttons.
 */
self.addEventListener('push', (event) => {
  let data = {
    title: 'Reminder Alert',
    body: 'You have a pending reminder',
    reminderId: null,
    type: 'ALERT',
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  // Handle silent sync signal (wake tab without showing notification banner)
  if (data.type === 'SILENT_SYNC') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({
            type: 'SILENT_SYNC_RECEIVED',
            timestamp: data.timestamp || new Date().toISOString(),
            mutatedReminderIds: data.mutatedReminderIds || [],
          });
        }
      })
    );
    return;
  }

  const title = data.title || 'DayStash Reminder';
  const options = {
    body: data.body || data.notes || 'Time to complete your reminder',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.reminderId ? `reminder-${data.reminderId}` : 'daystash-reminder',
    data: {
      reminderId: data.reminderId,
      title: data.title,
      notes: data.notes,
      url: '/',
    },
    actions: [
      {
        action: 'complete',
        title: '✓ Complete',
      },
      {
        action: 'snooze_10m',
        title: '⏰ Snooze 10m',
      },
    ],
    requireInteraction: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Notification Click Listener:
 * Intercepts user action buttons ("Complete", "Snooze 10m") and directly synchronizes
 * the mutation with POST /api/sync from the background worker.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const reminderId = event.notification.data?.reminderId;
  const reminderTitle = event.notification.data?.title || 'Reminder';
  const now = new Date().toISOString();

  // 1. Action: "Complete"
  if (action === 'complete' && reminderId) {
    const completePromise = fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'default-web-user',
      },
      body: JSON.stringify({
        deviceId: 'browser-service-worker',
        clientTimestamp: now,
        mutations: [
          {
            id: reminderId,
            title: reminderTitle,
            status: 'COMPLETED',
            version: 1,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
      }),
    })
      .then(async () => {
        // Broadcast completion to all open browser windows
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: 'REMINDER_UPDATED_FROM_NOTIFICATION',
            reminderId,
            status: 'COMPLETED',
          });
        }
      })
      .catch((err) => console.error('[SW] Failed to sync completion:', err));

    event.waitUntil(completePromise);
    return;
  }

  // 2. Action: "Snooze 10m"
  if (action === 'snooze_10m' && reminderId) {
    const snoozeTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const snoozePromise = fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'default-web-user',
      },
      body: JSON.stringify({
        deviceId: 'browser-service-worker',
        clientTimestamp: now,
        mutations: [
          {
            id: reminderId,
            title: reminderTitle,
            status: 'ACTIVE',
            nextTriggerUtc: snoozeTime,
            version: 1,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
      }),
    })
      .then(async () => {
        // Broadcast snooze to all open browser windows
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: 'REMINDER_UPDATED_FROM_NOTIFICATION',
            reminderId,
            status: 'ACTIVE',
            nextTriggerUtc: snoozeTime,
          });
        }
      })
      .catch((err) => console.error('[SW] Failed to sync snooze:', err));

    event.waitUntil(snoozePromise);
    return;
  }

  // 3. Body Click: Focus or open the dashboard window
  const urlToOpen = event.notification.data?.url || '/';
  const openPromise = self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    });

  event.waitUntil(openPromise);
});
