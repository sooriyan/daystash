'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';

export type RecurrenceType = 'ONE_OFF' | 'DAILY' | 'WEEKDAYS' | 'CUSTOM';

export interface ReminderItem {
  id: string;
  userId: string;
  title: string;
  notes?: string | null;
  rrule?: string | null;
  timezone: string;
  nextTriggerUtc?: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  syncDirty?: boolean;
}

const DEFAULT_USER_ID = 'default-web-user';

export default function ReminderDashboard() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [triggerDateTime, setTriggerDateTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('DAILY');
  const [customRrule, setCustomRrule] = useState('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR');

  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SYNCING' | 'SYNCED' | 'ERROR'>('IDLE');
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const [, startTransition] = useTransition();

  // Helper to determine the RRULE string based on selection
  const resolveRrule = (): string | null => {
    switch (recurrenceType) {
      case 'ONE_OFF':
        return null;
      case 'DAILY':
        return 'FREQ=DAILY;INTERVAL=1';
      case 'WEEKDAYS':
        return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
      case 'CUSTOM':
        return customRrule.trim();
    }
  };

  /**
   * Performs delta synchronization against POST /api/sync
   */
  const triggerDeltaSync = useCallback(
    async (mutationsToPush: ReminderItem[] = []) => {
      setSyncStatus('SYNCING');
      setSyncError(null);

      try {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const payload = {
          deviceId: 'web-browser-client',
          lastSyncedAt: lastSyncedTime,
          clientTimestamp: new Date().toISOString(),
          mutations: mutationsToPush.map((m) => ({
            id: m.id,
            title: m.title,
            notes: m.notes ?? null,
            rrule: m.rrule ?? null,
            timezone: m.timezone || userTimezone,
            nextTriggerUtc: m.nextTriggerUtc ?? null,
            status: m.status,
            version: m.version,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            deletedAt: m.deletedAt ?? null,
          })),
        };

        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': DEFAULT_USER_ID,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`Sync API HTTP ${res.status}`);
        }

        const data = await res.json();
        const { syncedAt, serverDeltas } = data;

        setLastSyncedTime(syncedAt);

        // Merge incoming server deltas with local state
        startTransition(() => {
          setReminders((prev) => {
            const map = new Map<string, ReminderItem>(prev.map((r) => [r.id, r]));

            for (const delta of serverDeltas) {
              map.set(delta.id, {
                id: delta.id,
                userId: delta.userId,
                title: delta.title,
                notes: delta.notes,
                rrule: delta.rrule,
                timezone: delta.timezone,
                nextTriggerUtc: delta.nextTriggerUtc,
                status: delta.status,
                version: delta.version,
                createdAt: delta.createdAt,
                updatedAt: delta.updatedAt,
                deletedAt: delta.deletedAt,
                syncDirty: false,
              });
            }

            return Array.from(map.values()).sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });
        });

        setSyncStatus('SYNCED');
      } catch (err) {
        console.error('[Dashboard Sync Error]:', err);
        setSyncStatus('ERROR');
        setSyncError(err instanceof Error ? err.message : 'Sync failed');
      }
    },
    [lastSyncedTime]
  );

  /**
   * Initial sync on component mount
   */
  useEffect(() => {
    triggerDeltaSync();
  }, [triggerDeltaSync]);

  /**
   * Automatic polling and revalidation when the browser tab regains focus or visibility
   */
  useEffect(() => {
    const handleFocus = () => {
      console.log('[Dashboard] Tab regained focus, revalidating sync...');
      triggerDeltaSync();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Dashboard] Document visible, revalidating sync...');
        triggerDeltaSync();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for Service Worker background completion/snooze messages
    if ('serviceWorker' in navigator) {
      const handleSwMessage = (event: MessageEvent) => {
        if (
          event.data?.type === 'REMINDER_UPDATED_FROM_NOTIFICATION' ||
          event.data?.type === 'SILENT_SYNC_RECEIVED'
        ) {
          console.log('[Dashboard] Received event from Service Worker, refreshing...');
          triggerDeltaSync();
        }
      };

      navigator.serviceWorker.addEventListener('message', handleSwMessage);
      return () => {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      };
    }

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerDeltaSync]);

  /**
   * Check browser notification permission on mount
   */
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  /**
   * Single-click Desktop Push Notification enablement:
   * Registers Service Worker and posts token to /api/devices/register
   */
  const handleEnableDesktopNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('Desktop notifications are not supported by this browser.');
      return;
    }

    setIsRegisteringPush(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === 'granted') {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        console.log('[SW] Service worker registered successfully:', registration.scope);

        // Register Web push device token with the backend
        const webPushToken = `ExponentPushToken[web_${DEFAULT_USER_ID}_${Date.now().toString(36)}]`;

        await fetch('/api/devices/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': DEFAULT_USER_ID,
          },
          body: JSON.stringify({
            expoPushToken: webPushToken,
            platform: 'web',
          }),
        });

        // Test display notification
        registration.showNotification('DayStash Desktop Notifications Active', {
          body: 'You will receive scheduled reminder alerts directly on your desktop.',
          icon: '/icon-192.png',
        });
      }
    } catch (err) {
      console.error('[Enable Notifications Error]:', err);
      alert('Failed to enable desktop notifications.');
    } finally {
      setIsRegisteringPush(false);
    }
  };

  /**
   * Optimistic Creation of a new Reminder
   */
  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const nowIso = new Date().toISOString();
    const triggerUtcIso = triggerDateTime ? new Date(triggerDateTime).toISOString() : null;

    const newReminder: ReminderItem = {
      id: crypto.randomUUID(),
      userId: DEFAULT_USER_ID,
      title: title.trim(),
      notes: notes.trim() || null,
      rrule: resolveRrule(),
      timezone: userTimezone,
      nextTriggerUtc: triggerUtcIso,
      status: 'ACTIVE',
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
      syncDirty: true,
    };

    // 1. Optimistic local state update
    setReminders((prev) => [newReminder, ...prev]);
    setTitle('');
    setNotes('');

    // 2. Dispatch sync
    await triggerDeltaSync([newReminder]);
  };

  /**
   * Optimistic Status Toggle (ACTIVE <-> COMPLETED)
   */
  const handleToggleReminder = async (reminder: ReminderItem) => {
    const updatedStatus = reminder.status === 'ACTIVE' ? 'COMPLETED' : 'ACTIVE';
    const updatedIso = new Date().toISOString();

    const mutated: ReminderItem = {
      ...reminder,
      status: updatedStatus,
      version: reminder.version + 1,
      updatedAt: updatedIso,
      syncDirty: true,
    };

    // 1. Optimistically update UI
    setReminders((prev) => prev.map((r) => (r.id === reminder.id ? mutated : r)));

    // 2. Dispatch sync
    await triggerDeltaSync([mutated]);
  };

  /**
   * Optimistic Soft-Delete
   */
  const handleDeleteReminder = async (reminder: ReminderItem) => {
    const updatedIso = new Date().toISOString();
    const mutated: ReminderItem = {
      ...reminder,
      deletedAt: updatedIso,
      version: reminder.version + 1,
      updatedAt: updatedIso,
      syncDirty: true,
    };

    setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
    await triggerDeltaSync([mutated]);
  };

  const visibleReminders = reminders.filter((r) => {
    if (r.deletedAt) return false;
    return r.status === activeTab;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header & Sync Status Indicator */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-border mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400">⚡</span>
              DayStash
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700">
              Offline-First Multi-Device
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time synchronization across Mobile, Web, and Background Workers.
          </p>
        </div>

        {/* Real-time Sync Indicator */}
        <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-xl border border-border">
          <div className="flex items-center gap-2">
            {syncStatus === 'SYNCING' && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
              </span>
            )}
            {syncStatus === 'SYNCED' && (
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            )}
            {syncStatus === 'ERROR' && (
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
            )}
            {syncStatus === 'IDLE' && (
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500"></span>
            )}

            <span className="text-xs font-medium text-slate-300">
              {syncStatus === 'SYNCING' && 'Synchronizing...'}
              {syncStatus === 'SYNCED' && (lastSyncedTime ? `Synced at ${new Date(lastSyncedTime).toLocaleTimeString()}` : 'Synced')}
              {syncStatus === 'ERROR' && (syncError || 'Sync Error')}
              {syncStatus === 'IDLE' && 'Ready'}
            </span>
          </div>

          <button
            onClick={() => triggerDeltaSync()}
            title="Force delta sync"
            className="text-xs text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Enable Desktop Notifications Banner */}
      {notificationPermission !== 'granted' && (
        <section className="mb-8 p-4 rounded-xl bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border border-indigo-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-indigo-950/20">
          <div className="flex items-start sm:items-center gap-3">
            <span className="text-2xl">🔔</span>
            <div>
              <h2 className="text-sm font-semibold text-white">Enable Desktop Push Notifications</h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Receive proactive desktop alerts with 1-click &quot;Complete&quot; and &quot;Snooze&quot; action buttons.
              </p>
            </div>
          </div>
          <button
            onClick={handleEnableDesktopNotifications}
            disabled={isRegisteringPush}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-all shadow-md shadow-indigo-600/30 whitespace-nowrap self-start sm:self-auto"
          >
            {isRegisteringPush ? 'Registering...' : 'Enable Notifications'}
          </button>
        </section>
      )}

      {/* Create Reminder Card */}
      <section className="bg-card rounded-2xl border border-border p-6 shadow-xl mb-8">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
          <span>✍️</span> Create Reminder
        </h2>
        <form onSubmit={handleCreateReminder} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="What do you need to be reminded of?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#0c121e] border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">First Trigger Date & Time</label>
              <input
                type="datetime-local"
                value={triggerDateTime}
                onChange={(e) => setTriggerDateTime(e.target.value)}
                className="w-full bg-[#0c121e] border border-border rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Recurrence Pattern</label>
              <div className="grid grid-cols-4 gap-1.5 bg-[#0c121e] p-1 rounded-xl border border-border">
                {(['ONE_OFF', 'DAILY', 'WEEKDAYS', 'CUSTOM'] as RecurrenceType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setRecurrenceType(type)}
                    className={`py-1.5 text-xs font-medium rounded-lg transition-all ${
                      recurrenceType === type
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {type === 'ONE_OFF' && 'One-off'}
                    {type === 'DAILY' && 'Daily'}
                    {type === 'WEEKDAYS' && 'Weekdays'}
                    {type === 'CUSTOM' && 'Custom'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {recurrenceType === 'CUSTOM' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">RFC 5545 RRULE Specification</label>
              <input
                type="text"
                value={customRrule}
                onChange={(e) => setCustomRrule(e.target.value)}
                placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                className="w-full bg-[#0c121e] border border-border rounded-xl px-3.5 py-2 text-xs font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
          )}

          <div>
            <textarea
              placeholder="Optional notes or instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-[#0c121e] border border-border rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-all shadow-md shadow-indigo-600/30 flex items-center gap-2"
            >
              <span>+</span> Add Reminder
            </button>
          </div>
        </form>
      </section>

      {/* Tabs: Active vs Completed */}
      <div className="flex items-center gap-4 mb-4 border-b border-border pb-2">
        <button
          onClick={() => setActiveTab('ACTIVE')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'ACTIVE'
              ? 'border-indigo-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Active Reminders ({reminders.filter((r) => r.status === 'ACTIVE' && !r.deletedAt).length})
        </button>
        <button
          onClick={() => setActiveTab('COMPLETED')}
          className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
            activeTab === 'COMPLETED'
              ? 'border-indigo-500 text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Completed ({reminders.filter((r) => r.status === 'COMPLETED' && !r.deletedAt).length})
        </button>
      </div>

      {/* Reminders List */}
      <section className="space-y-3">
        {visibleReminders.length === 0 ? (
          <div className="text-center py-12 bg-card rounded-2xl border border-dashed border-border text-slate-500 text-sm">
            {activeTab === 'ACTIVE' ? 'No active reminders. Add one above!' : 'No completed reminders yet.'}
          </div>
        ) : (
          visibleReminders.map((reminder) => (
            <div
              key={reminder.id}
              className={`flex items-start justify-between p-4 rounded-xl bg-card border border-border hover:border-slate-700 transition-all ${
                reminder.status === 'COMPLETED' ? 'opacity-60' : ''
              }`}
            >
              <div className="flex items-start gap-3.5">
                {/* Checkbox Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggleReminder(reminder)}
                  className={`mt-1 h-5 w-5 rounded-md border flex items-center justify-center transition-all ${
                    reminder.status === 'COMPLETED'
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-slate-600 hover:border-indigo-400 bg-[#0c121e]'
                  }`}
                >
                  {reminder.status === 'COMPLETED' && (
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                      <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                    </svg>
                  )}
                </button>

                <div>
                  <h3
                    className={`text-sm font-medium text-white ${
                      reminder.status === 'COMPLETED' ? 'line-through text-slate-400' : ''
                    }`}
                  >
                    {reminder.title}
                  </h3>

                  {reminder.notes && (
                    <p className="text-xs text-slate-400 mt-0.5">{reminder.notes}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-slate-400">
                    {reminder.nextTriggerUtc && (
                      <span className="flex items-center gap-1 bg-[#0c121e] px-2 py-0.5 rounded-md border border-border">
                        ⏰ {new Date(reminder.nextTriggerUtc).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}

                    {reminder.rrule && (
                      <span className="flex items-center gap-1 bg-indigo-950/40 text-indigo-300 px-2 py-0.5 rounded-md border border-indigo-900/50">
                        🔄 {reminder.rrule.includes('FREQ=DAILY') ? 'Daily' : reminder.rrule.includes('BYDAY=MO,TU,WE,TH,FR') ? 'Weekdays' : 'Recurring'}
                      </span>
                    )}

                    {reminder.syncDirty && (
                      <span className="text-amber-400 italic">● pending sync</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Delete Button */}
              <button
                type="button"
                onClick={() => handleDeleteReminder(reminder)}
                className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg transition-colors"
                title="Delete reminder"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
