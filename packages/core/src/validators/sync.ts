import { z } from 'zod';

/**
 * Validates that a string is a recognized IANA timezone identifier
 * using the JavaScript Intl API.
 */
export const isValidTimezone = (tz: string): boolean => {
  if (typeof tz !== 'string' || tz.trim().length === 0) {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * IANA Timezone Zod Schema
 */
export const IanaTimezoneSchema = z
  .string()
  .min(1, 'Timezone is required')
  .refine(isValidTimezone, {
    message: 'Must be a valid IANA timezone identifier (e.g., "Asia/Kolkata", "America/New_York")',
  });

/**
 * Reminder Status Enum Schema
 */
export const ReminderStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'ARCHIVED']);

/**
 * Client Dirty Mutation Schema
 * Represents a local reminder mutated offline by the React Native client
 * ready to be pushed to the server during synchronization.
 */
export const ReminderSyncMutationSchema = z.object({
  id: z.string().min(1, 'Reminder ID is required'),
  title: z
    .string()
    .min(1, 'Title cannot be empty')
    .max(500, 'Title cannot exceed 500 characters'),
  notes: z
    .string()
    .max(10000, 'Notes cannot exceed 10,000 characters')
    .nullable()
    .optional(),
  rrule: z.string().nullable().optional(),
  timezone: IanaTimezoneSchema,
  nextTriggerUtc: z
    .string()
    .datetime({ message: 'nextTriggerUtc must be a valid ISO 8601 UTC timestamp' })
    .nullable()
    .optional(),
  status: ReminderStatusSchema,
  version: z
    .number()
    .int('Version must be an integer')
    .min(1, 'Version must be greater than or equal to 1'),
  createdAt: z
    .string()
    .datetime({ message: 'createdAt must be a valid ISO 8601 UTC timestamp' }),
  updatedAt: z
    .string()
    .datetime({ message: 'updatedAt must be a valid ISO 8601 UTC timestamp' }),
  deletedAt: z
    .string()
    .datetime({ message: 'deletedAt must be a valid ISO 8601 UTC timestamp' })
    .nullable()
    .optional(),
});

/**
 * Server Delta Record Schema
 * Represents a reminder record changed on the server or on another peer device
 * that needs to be merged into the client's local SQLite database.
 */
export const ReminderServerDeltaSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  rrule: z.string().nullable(),
  timezone: z.string(),
  nextTriggerUtc: z.string().nullable(),
  status: ReminderStatusSchema,
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

/**
 * Sync Conflict Schema
 * Emitted when client version < server version or if concurrent modification detected.
 */
export const SyncConflictReasonSchema = z.enum([
  'VERSION_CONFLICT',
  'STALE_UPDATE',
  'DELETED_ON_SERVER',
  'VALIDATION_ERROR',
]);

export const SyncConflictSchema = z.object({
  id: z.string(),
  reason: SyncConflictReasonSchema,
  message: z.string(),
  serverRecord: ReminderServerDeltaSchema.optional(),
});

/**
 * Complete /api/sync Request Payload Schema
 */
export const SyncRequestSchema = z.object({
  deviceId: z.string().min(1, 'Device identifier is required'),
  /**
   * ISO 8601 timestamp of client's last successful sync.
   * If null or omitted, server performs an initial hydration / complete delta fetch.
   */
  lastSyncedAt: z
    .string()
    .datetime({ message: 'lastSyncedAt must be a valid ISO 8601 UTC timestamp' })
    .nullable()
    .optional(),
  clientTimestamp: z
    .string()
    .datetime({ message: 'clientTimestamp must be a valid ISO 8601 UTC timestamp' }),
  /**
   * Array of local mutations marked as dirty (sync_dirty = 1) by the client.
   */
  mutations: z.array(ReminderSyncMutationSchema).default([]),
});

/**
 * Complete /api/sync Response Payload Schema
 */
export const SyncResponseSchema = z.object({
  /**
   * Server timestamp at time of sync processing.
   * Client must persist this into `client_sync_state.last_synced_at`.
   */
  syncedAt: z
    .string()
    .datetime({ message: 'syncedAt must be a valid ISO 8601 UTC timestamp' }),
  /**
   * IDs of client mutations that were successfully committed to PostgreSQL.
   * Client marks these records as clean (sync_dirty = 0).
   */
  appliedRecordIds: z.array(z.string()),
  /**
   * Records that could not be applied due to conflicts or validation rules.
   */
  conflicts: z.array(SyncConflictSchema),
  /**
   * Deltas from other devices or worker modifications since client's `lastSyncedAt`.
   * Client upserts these into SQLite with `sync_dirty = 0`.
   */
  serverDeltas: z.array(ReminderServerDeltaSchema),
});

// Inferred TypeScript Types
export type ReminderStatusType = z.infer<typeof ReminderStatusSchema>;
export type ReminderSyncMutation = z.infer<typeof ReminderSyncMutationSchema>;
export type ReminderServerDelta = z.infer<typeof ReminderServerDeltaSchema>;
export type SyncConflictReason = z.infer<typeof SyncConflictReasonSchema>;
export type SyncConflict = z.infer<typeof SyncConflictSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
