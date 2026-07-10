/**
 * Pure schedule <-> cron helpers for the Report cadence facet. Kept out of
 * the React component so the round-trip (friendly picker -> cron -> friendly
 * picker) is unit-testable as plain functions.
 *
 * We only speak the three cron shapes the friendly picker emits:
 *   daily    `m h * * *`
 *   weekly   `m h * * D`   (D = 0-6, 0 = Sunday)
 *   monthly  `m h D * *`   (D = 1-31)
 * Any other expression is "custom" — `partsFromCron` returns null so the
 * drawer can drop into the raw-cron editor without losing the value.
 */

export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleParts {
  frequency: Frequency;
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
  /** cron day-of-week, 0-6 (0 = Sunday). Only meaningful when weekly. */
  dayOfWeek: number;
  /** cron day-of-month, 1-31. Only meaningful when monthly. */
  dayOfMonth: number;
}

/** The seeded friendly schedule — weekly, Monday 09:00 — matching the legacy
 *  `INITIAL_REPORT_DRAFT.cron` of `0 9 * * 1` so a fresh report opens with the
 *  same default the raw input used to carry. */
export const DEFAULT_PARTS: ScheduleParts = {
  frequency: "weekly",
  hour: 9,
  minute: 0,
  dayOfWeek: 1,
  dayOfMonth: 1,
};

/** Weekday names indexed by cron day-of-week (0 = Sunday), for summaries. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Day-of-week chips in Mon-first reading order, mapped to cron dow numbers. */
export const WEEKDAY_OPTIONS: Array<{
  value: number;
  short: string;
  long: string;
}> = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** English ordinal for the day-of-month label (1 -> "1st", 22 -> "22nd"). */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:MM` for a time input, from the parts' hour + minute. */
export function timeOfDay(parts: Pick<ScheduleParts, "hour" | "minute">): string {
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Build the cron expression for the current friendly parts. */
export function cronFromParts(parts: ScheduleParts): string {
  const { minute, hour } = parts;
  switch (parts.frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${parts.dayOfWeek}`;
    case "monthly":
      return `${minute} ${hour} ${parts.dayOfMonth} * *`;
  }
}

/** Parse a single non-negative integer field, or null if it isn't one plain
 *  integer in range. Rejects anything with a list, range, or step operator so
 *  only a bare number (never "1,2", "1-5", or a stepped value) round-trips. */
function parseInt0(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null;
  const n = Number(field);
  return n >= min && n <= max ? n : null;
}

/**
 * Map a cron string back to the friendly picker parts. Returns null for any
 * expression outside the three shapes we generate ("custom") so the caller
 * can fall back to the raw-cron editor.
 */
export function partsFromCron(cron: string): ScheduleParts | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minField, hourField, domField, monField, dowField] = fields;

  const minute = parseInt0(minField ?? "", 0, 59);
  const hour = parseInt0(hourField ?? "", 0, 23);
  if (minute === null || hour === null) return null;
  // Month must be wildcard for every shape we speak.
  if (monField !== "*") return null;

  const base = { hour, minute, dayOfWeek: 1, dayOfMonth: 1 };

  if (domField === "*" && dowField === "*") {
    return { ...base, frequency: "daily" };
  }
  if (domField === "*" && dowField !== "*") {
    const dayOfWeek = parseInt0(dowField ?? "", 0, 6);
    if (dayOfWeek === null) return null;
    return { ...base, frequency: "weekly", dayOfWeek };
  }
  if (domField !== "*" && dowField === "*") {
    const dayOfMonth = parseInt0(domField ?? "", 1, 31);
    if (dayOfMonth === null) return null;
    return { ...base, frequency: "monthly", dayOfMonth };
  }
  return null;
}

/**
 * Friendly, sentence-form summary of the friendly schedule for the live
 * "this sends…" line, e.g. "Sends every Monday at 09:00 (Europe/Amsterdam)".
 */
export function summarizeSchedule(
  parts: ScheduleParts,
  timezone: string,
): string {
  const at = timeOfDay(parts);
  const tz = timezone.trim() || "UTC";
  switch (parts.frequency) {
    case "daily":
      return `Sends every day at ${at} (${tz})`;
    case "weekly":
      return `Sends every ${WEEKDAYS[parts.dayOfWeek] ?? "day"} at ${at} (${tz})`;
    case "monthly":
      return `Sends on the ${ordinal(parts.dayOfMonth)} of each month at ${at} (${tz})`;
  }
}

/**
 * Humanise a raw cron for the advanced-mode summary. Mirrors the page's
 * `describeSchedule` (kept in sync by intent — the page's copy is outside this
 * feature slice), falling back to the raw expression for shapes we can't name.
 */
export function describeCron(cron: string, timezone: string): string {
  const parts = partsFromCron(cron);
  if (!parts) return `${cron.trim()} (${timezone.trim() || "UTC"})`;
  return summarizeSchedule(parts, timezone);
}

/** Reads the viewer's IANA timezone, falling back to UTC when unavailable. */
export function defaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : "UTC";
  } catch {
    return "UTC";
  }
}

/** A short, safe list of common IANA zones for runtimes without
 *  `Intl.supportedValuesOf` (older engines). Grouped roughly by region. */
export const CURATED_TIMEZONES: string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Moscow",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** The full IANA zone list from the platform, or the curated fallback. */
export function supportedTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const zones = Intl.supportedValuesOf("timeZone");
      if (zones.length > 0) return zones;
    }
  } catch {
    // fall through to the curated list
  }
  return CURATED_TIMEZONES;
}

/**
 * Group zones into `<optgroup>`s by region prefix (the segment before the
 * first "/"), so a 400-entry native select reads as a tidy continent list.
 * Single-segment zones (UTC, GMT) collect under "General".
 */
export function groupTimezones(
  zones: string[],
): Array<{ region: string; zones: string[] }> {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const slash = zone.indexOf("/");
    const region = slash === -1 ? "General" : zone.slice(0, slash);
    const list = groups.get(region) ?? [];
    list.push(zone);
    groups.set(region, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      // Keep "General" (UTC etc.) pinned to the top; sort the rest A-Z.
      if (a === "General") return -1;
      if (b === "General") return 1;
      return a.localeCompare(b);
    })
    .map(([region, list]) => ({ region, zones: list.sort() }));
}
