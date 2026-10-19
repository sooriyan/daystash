import * as SQLite from 'expo-sqlite';

export const DATABASE_NAME = 'daystash.db';

export interface LocalReminderRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  rrule: string | null;
  timezone: string;
  next_trigger_utc: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_notification_id: string | null;
  sync_dirty: number;
}

export interface MetaRow {
  key: string;
  value: string;
  updated_at: string;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Returns the open SQLiteDatabase instance, initializing tables if needed.
 */
export function getLocalDatabase(dbName: string = DATABASE_NAME): SQLite.SQLiteDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  const db = SQLite.openDatabaseSync(dbName);
  initializeDatabaseSchema(db);
  dbInstance = db;
  return db;
}

/**
 * Executes SQLite DDL to initialize reminders, meta table, and required indices.
 */
export function initializeDatabaseSchema(db: SQLite.SQLiteDatabase): void {
  db.execSync(`
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

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_sync_dirty
      ON reminders (sync_dirty)
      WHERE sync_dirty = 1;

    CREATE INDEX IF NOT EXISTS idx_reminders_next_trigger
      ON reminders (next_trigger_utc)
      WHERE status = 'ACTIVE' AND deleted_at IS NULL;
  `);
}

/**
 * Retrieves a string value from the meta table.
 */
export function getMetaValue(db: SQLite.SQLiteDatabase, key: string): string | null {
  const row = db.getFirstSync<MetaRow>(
    'SELECT key, value, updated_at FROM meta WHERE key = ?',
    [key]
  );
  return row ? row.value : null;
}

/**
 * Sets or updates a key-value pair in the meta table.
 */
export function setMetaValue(
  db: SQLite.SQLiteDatabase,
  key: string,
  value: string
): void {
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now]
  );
}

/**
 * Gets or creates a stable client device ID.
 */
export function getOrCreateDeviceId(db: SQLite.SQLiteDatabase): string {
  const existing = getMetaValue(db, 'device_id');
  if (existing) {
    return existing;
  }

  const newDeviceId = `device-rn-${crypto.randomUUID()}`;
  setMetaValue(db, 'device_id', newDeviceId);
  return newDeviceId;
}
