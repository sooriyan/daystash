import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { ReminderStatus } from './postgres.js';

/**
 * Client Reminders Table (Drizzle SQLite ORM)
 * Mirror of the PostgreSQL schema optimized for offline React Native / Expo SQLite clients,
 * augmented with local notification scheduling IDs and offline dirty sync flags.
 */
export const clientReminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    rrule: text('rrule'),
    timezone: text('timezone').notNull().default('UTC'),
    /**
     * Stored as ISO 8601 UTC string (e.g., '2026-03-08T14:00:00.000Z')
     * for deterministic lexicographical ordering and SQLite indexing.
     */
    nextTriggerUtc: text('next_trigger_utc'),
    status: text('status').$type<ReminderStatus>().notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),

    /**
     * Client-Specific Columns for Offline-First Architecture
     */
    // Native OS identifier for scheduled local notification (e.g. expo-notifications notificationId)
    localNotificationId: text('local_notification_id'),
    // Flag indicating pending upstream synchronization (1 = dirty / mutated locally, 0 = synced)
    syncDirty: integer('sync_dirty').notNull().default(1),
  },
  (table) => [
    /**
     * Partial Index for Local Notification Rescheduling:
     * Fast lookup of upcoming active reminders for OS background triggers.
     */
    index('idx_client_reminders_next_trigger')
      .on(table.nextTriggerUtc)
      .where(sql`${table.status} = 'ACTIVE' AND ${table.deletedAt} IS NULL`),

    /**
     * Partial Index for Dirty Mutation Scanning:
     * Immediate retrieval of local changes ready to push during /api/sync.
     */
    index('idx_client_reminders_sync_dirty')
      .on(table.syncDirty)
      .where(sql`${table.syncDirty} = 1`),

    /**
     * Compound Index for Local Ordering & Queries
     */
    index('idx_client_reminders_user_updated').on(table.userId, table.updatedAt),
  ]
);

/**
 * Client Sync State Table
 * Tracks client-wide sync metadata (e.g., lastSyncedAt, deviceId, schemaVersion).
 */
export const clientSyncState = sqliteTable('client_sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Raw SQLite DDL Scripts for Direct Database Initialization / Migrations
 * (e.g. expo-sqlite db.execAsync(SQLITE_INITIALIZE_SCHEMA_DDL))
 */
export const SQLITE_REMINDERS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  rrule TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  next_trigger_utc TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'ARCHIVED')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  local_notification_id TEXT,
  sync_dirty INTEGER NOT NULL DEFAULT 1
);
`.trim();

export const SQLITE_CLIENT_SYNC_STATE_DDL = `
CREATE TABLE IF NOT EXISTS client_sync_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`.trim();

export const SQLITE_INDICES_DDL = `
CREATE INDEX IF NOT EXISTS idx_client_reminders_next_trigger
  ON reminders (next_trigger_utc)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_reminders_sync_dirty
  ON reminders (sync_dirty)
  WHERE sync_dirty = 1;

CREATE INDEX IF NOT EXISTS idx_client_reminders_user_updated
  ON reminders (user_id, updated_at);
`.trim();

/**
 * Complete Composite SQLite Schema Bootstrap DDL
 */
export const SQLITE_INITIALIZE_SCHEMA_DDL = `
${SQLITE_REMINDERS_TABLE_DDL}

${SQLITE_CLIENT_SYNC_STATE_DDL}

${SQLITE_INDICES_DDL}
`.trim();

// Strictly Typed Inferred Models
export type ClientReminder = typeof clientReminders.$inferSelect;
export type NewClientReminder = typeof clientReminders.$inferInsert;

export type ClientSyncState = typeof clientSyncState.$inferSelect;
export type NewClientSyncState = typeof clientSyncState.$inferInsert;
