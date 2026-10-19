import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

/**
 * PostgreSQL Enum for Reminder Lifecycle Statuses
 */
export const reminderStatusEnum = pgEnum('reminder_status', [
  'ACTIVE',
  'COMPLETED',
  'ARCHIVED',
]);

/**
 * PostgreSQL Enum for Device Platforms
 */
export const devicePlatformEnum = pgEnum('device_platform', [
  'ios',
  'android',
  'web',
]);

export type ReminderStatus = (typeof reminderStatusEnum.enumValues)[number];
export type DevicePlatform = (typeof devicePlatformEnum.enumValues)[number];

/**
 * Users Table
 * Master record for user identities across authenticated sessions.
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
});

/**
 * User Devices Table
 * Tracks all client devices registered for push notifications (Expo Push Tokens).
 */
export const userDevices = pgTable(
  'user_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token').notNull(),
    platform: devicePlatformEnum('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_user_devices_user_id').on(table.userId),
    uniqueIndex('idx_user_devices_token_user').on(table.userId, table.expoPushToken),
  ]
);

/**
 * Reminders Table
 * Central table storing reminders, recurrence specifications, and trigger coordinates.
 */
export const reminders = pgTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    rrule: text('rrule'),
    timezone: text('timezone').notNull().default('UTC'),
    nextTriggerUtc: timestamp('next_trigger_utc', { withTimezone: true, mode: 'date' }),
    status: reminderStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    /**
     * Partial Index for Scheduler Worker Polling:
     * High-frequency index targeting only ACTIVE and non-deleted reminders.
     * Essential for sub-millisecond dispatch worker query performance:
     * SELECT * FROM reminders WHERE status = 'ACTIVE' AND deleted_at IS NULL AND next_trigger_utc <= NOW()
     */
    index('idx_reminders_next_trigger_active')
      .on(table.nextTriggerUtc)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.deletedAt} IS NULL`),

    /**
     * Compound Index for Delta Sync:
     * Fast retrieval of incremental changes for a user:
     * SELECT * FROM reminders WHERE user_id = $1 AND updated_at > $2
     */
    index('idx_reminders_user_sync').on(table.userId, table.updatedAt),
  ]
);

// Relational Definitions
export const usersRelations = relations(users, ({ many }) => ({
  devices: many(userDevices),
  reminders: many(reminders),
}));

export const userDevicesRelations = relations(userDevices, ({ one }) => ({
  user: one(users, {
    fields: [userDevices.userId],
    references: [users.id],
  }),
}));

export const remindersRelations = relations(reminders, ({ one }) => ({
  user: one(users, {
    fields: [reminders.userId],
    references: [users.id],
  }),
}));

// Strictly Typed Inferred Models
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
