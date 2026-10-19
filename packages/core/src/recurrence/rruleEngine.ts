import { TZDate } from '@date-fns/tz';
import * as rrulePackage from 'rrule';

// Handle CommonJS / ESM interoperability for rrule package
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rruleLib: any = (rrulePackage as any).default ?? rrulePackage;
const RRule: typeof rrulePackage.RRule = rruleLib.RRule ?? rruleLib;
const rrulestr: typeof rrulePackage.rrulestr = rruleLib.rrulestr ?? rruleLib.default?.rrulestr;

/**
 * Options for recurrence calculation
 */
export interface RecurrenceOptions {
  /**
   * If true, allows the referenceUtcDate itself to be returned if it strictly matches
   * the recurrence rule. Default is false (strictly after reference date).
   */
  inclusive?: boolean;

  /**
   * Optional custom DTSTART wall-clock anchor date.
   * If not provided and not present in the RRULE string, referenceUtcDate in local timezone is used.
   */
  dtstart?: Date;
}

/**
 * Validates that an IANA timezone string is recognized by the runtime environment.
 * Throws a TypeError if the timezone identifier is invalid.
 */
export function validateTimezone(timezone: string): void {
  if (!timezone || typeof timezone !== 'string') {
    throw new TypeError(`Invalid timezone: timezone must be a non-empty string, received: ${String(timezone)}`);
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new TypeError(
      `Invalid IANA timezone identifier: "${timezone}". Must be a valid timezone (e.g., "Asia/Kolkata", "America/New_York", "UTC").`
    );
  }
}

/**
 * Converts a UTC Date into a floating wall-clock Date representation
 * matching the user's local wall-clock values in the specified IANA timezone.
 */
export function toFloatingWallClockDate(date: Date, timezone: string): Date {
  const localTz = new TZDate(date, timezone);
  return new Date(
    Date.UTC(
      localTz.getFullYear(),
      localTz.getMonth(),
      localTz.getDate(),
      localTz.getHours(),
      localTz.getMinutes(),
      localTz.getSeconds(),
      localTz.getMilliseconds()
    )
  );
}

/**
 * Converts a floating wall-clock Date representation back into an exact UTC Date,
 * taking into account the IANA timezone and DST offsets.
 */
export function fromFloatingWallClockDate(floatingDate: Date, timezone: string): Date {
  const localTz = new TZDate(
    floatingDate.getUTCFullYear(),
    floatingDate.getUTCMonth(),
    floatingDate.getUTCDate(),
    floatingDate.getUTCHours(),
    floatingDate.getUTCMinutes(),
    floatingDate.getUTCSeconds(),
    floatingDate.getUTCMilliseconds(),
    timezone
  );

  return new Date(localTz.getTime());
}

/**
 * Normalizes an RFC 5545 string so it can be parsed cleanly by rrulestr.
 * Strips whitespace, ensures proper 'RRULE:' prefix if bare FREQ is provided.
 */
export function normalizeRRuleString(rruleString: string): string {
  const trimmed = rruleString.trim();
  if (trimmed.length === 0) {
    throw new Error('RRULE string cannot be empty.');
  }

  // If bare rule without RRULE: or DTSTART header, prefix with RRULE:
  if (!trimmed.includes('RRULE:') && !trimmed.startsWith('DTSTART')) {
    return `RRULE:${trimmed}`;
  }

  return trimmed;
}

/**
 * Computes the next occurrence in UTC for an RFC 5545 recurrence rule,
 * correctly handling IANA timezones and Daylight Saving Time (DST) boundaries.
 *
 * @param rruleString - RFC 5545 recurrence rule (e.g., "FREQ=DAILY;INTERVAL=1" or full iCalendar string)
 * @param timezone - IANA timezone identifier (e.g., 'Asia/Kolkata', 'America/New_York')
 * @param referenceUtcDate - Anchor/reference UTC Date. Defaults to the current moment.
 * @param options - Additional evaluation options (inclusive, dtstart anchor).
 * @returns The next occurrence as a UTC Date, or null if the rule has no future occurrences.
 */
export function computeNextOccurrence(
  rruleString: string,
  timezone: string,
  referenceUtcDate: Date = new Date(),
  options: RecurrenceOptions = {}
): Date | null {
  validateTimezone(timezone);

  const normalized = normalizeRRuleString(rruleString);
  const floatingRef = toFloatingWallClockDate(referenceUtcDate, timezone);

  // Check if string has explicit DTSTART
  const hasEmbeddedDtStart = normalized.includes('DTSTART');

  // If a custom dtstart was provided, map it to floating wall-clock;
  // If not provided and string has no embedded DTSTART, fallback to floatingRef.
  let floatingDtStart: Date | undefined;
  if (options.dtstart) {
    floatingDtStart = toFloatingWallClockDate(options.dtstart, timezone);
  } else if (!hasEmbeddedDtStart) {
    floatingDtStart = floatingRef;
  }

  // Parse rule with dtstart anchored in floating wall-clock time
  const rule = rrulestr(normalized, {
    ...(floatingDtStart ? { dtstart: floatingDtStart } : {}),
    forceset: false,
    unfold: true,
  });

  const nextFloating = rule.after(floatingRef, options.inclusive ?? false);
  if (!nextFloating) {
    return null;
  }

  return fromFloatingWallClockDate(nextFloating, timezone);
}

/**
 * Computes the next N occurrences in UTC across DST transitions.
 *
 * @param rruleString - RFC 5545 recurrence rule
 * @param timezone - IANA timezone identifier
 * @param referenceUtcDate - Anchor UTC Date
 * @param count - Maximum number of occurrences to return
 * @param options - Recurrence options
 * @returns Array of next occurrences in UTC Date format
 */
export function computeNextOccurrences(
  rruleString: string,
  timezone: string,
  referenceUtcDate: Date = new Date(),
  count: number = 10,
  options: RecurrenceOptions = {}
): Date[] {
  if (count <= 0) {
    return [];
  }

  validateTimezone(timezone);
  const normalized = normalizeRRuleString(rruleString);
  const floatingRef = toFloatingWallClockDate(referenceUtcDate, timezone);
  const hasEmbeddedDtStart = normalized.includes('DTSTART');

  let floatingDtStart: Date | undefined;
  if (options.dtstart) {
    floatingDtStart = toFloatingWallClockDate(options.dtstart, timezone);
  } else if (!hasEmbeddedDtStart) {
    floatingDtStart = floatingRef;
  }

  const rule = rrulestr(normalized, {
    ...(floatingDtStart ? { dtstart: floatingDtStart } : {}),
    forceset: false,
    unfold: true,
  });

  const occurrences: Date[] = [];
  let currentFloating = floatingRef;
  let isFirst = true;

  for (let i = 0; i < count; i++) {
    const nextFloating = rule.after(
      currentFloating,
      isFirst ? (options.inclusive ?? false) : false
    );

    if (!nextFloating) {
      break;
    }

    occurrences.push(fromFloatingWallClockDate(nextFloating, timezone));
    currentFloating = nextFloating;
    isFirst = false;
  }

  return occurrences;
}

/**
 * Computes all occurrences between two UTC timestamps in a specified timezone.
 *
 * @param rruleString - RFC 5545 recurrence rule
 * @param timezone - IANA timezone identifier
 * @param startUtcDate - Beginning of time window (UTC)
 * @param endUtcDate - End of time window (UTC)
 * @param options - Recurrence options
 * @returns Array of occurrences within the range
 */
export function computeOccurrencesBetween(
  rruleString: string,
  timezone: string,
  startUtcDate: Date,
  endUtcDate: Date,
  options: RecurrenceOptions = {}
): Date[] {
  validateTimezone(timezone);

  if (startUtcDate.getTime() > endUtcDate.getTime()) {
    throw new Error('startUtcDate cannot be after endUtcDate.');
  }

  const normalized = normalizeRRuleString(rruleString);
  const floatingStart = toFloatingWallClockDate(startUtcDate, timezone);
  const floatingEnd = toFloatingWallClockDate(endUtcDate, timezone);
  const hasEmbeddedDtStart = normalized.includes('DTSTART');

  let floatingDtStart: Date | undefined;
  if (options.dtstart) {
    floatingDtStart = toFloatingWallClockDate(options.dtstart, timezone);
  } else if (!hasEmbeddedDtStart) {
    floatingDtStart = floatingStart;
  }

  const rule = rrulestr(normalized, {
    ...(floatingDtStart ? { dtstart: floatingDtStart } : {}),
    forceset: false,
    unfold: true,
  });

  const floatingOccurrences = rule.between(floatingStart, floatingEnd, options.inclusive ?? true);
  return floatingOccurrences.map((f) => fromFloatingWallClockDate(f, timezone));
}

/**
 * Pure validation utility for RFC 5545 RRULE strings.
 */
export function validateRRule(rruleString: string): { isValid: boolean; error?: string } {
  try {
    const normalized = normalizeRRuleString(rruleString);
    rrulestr(normalized, { dtstart: new Date() });
    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: err instanceof Error ? err.message : 'Invalid recurrence rule string',
    };
  }
}

/**
 * Converts an RFC 5545 string into a human-readable description.
 */
export function formatRRuleHumanReadable(rruleString: string): string {
  try {
    const normalized = normalizeRRuleString(rruleString);
    const rule = rrulestr(normalized, { dtstart: new Date() });
    return rule.toText();
  } catch {
    return rruleString;
  }
}

export { RRule, rrulestr };
