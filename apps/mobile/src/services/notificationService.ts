import * as Notifications from 'expo-notifications';

/**
 * Safely cancels a scheduled native OS notification by its notification ID.
 */
export async function cancelScheduledNotificationAsync(
  localNotificationId: string | null | undefined
): Promise<void> {
  if (!localNotificationId || localNotificationId.trim().length === 0) {
    return;
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(localNotificationId);
  } catch (error) {
    console.warn(
      `[Notifications] Failed to cancel scheduled notification ${localNotificationId}:`,
      error
    );
  }
}

/**
 * Schedules a local notification for an upcoming reminder trigger date.
 * Returns the native notification ID, or null if scheduling failed.
 */
export async function scheduleLocalReminderNotificationAsync(params: {
  id: string;
  title: string;
  notes?: string | null;
  triggerDate: Date;
}): Promise<string | null> {
  try {
    const { id, title, notes, triggerDate } = params;

    // Do not schedule past triggers
    if (triggerDate.getTime() <= Date.now()) {
      return null;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: notes || 'Reminder',
        data: { reminderId: id },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    });

    return notificationId;
  } catch (error) {
    console.warn(`[Notifications] Failed to schedule notification for reminder ${params.id}:`, error);
    return null;
  }
}
