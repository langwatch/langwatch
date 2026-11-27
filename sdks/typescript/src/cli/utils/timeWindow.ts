/**
 * The time window the trace and analytics commands read. Every `--start-date`,
 * `--end-date` and `--since` takes the same values, so an agent that saw a trace
 * "yesterday" or "last month" can say so instead of computing an ISO instant.
 */
import { parseInstantOrNull } from "./instant";

/** How far back a command reads when the caller names no window. */
export const DEFAULT_LOOKBACK = "7d";

/** The one wider lookback `trace search` tries when the default window is empty. */
export const WIDENED_LOOKBACK = "30d";

/** Lookbacks offered, in order, when a window came back empty. */
const WIDER_LOOKBACKS = ["30d", "90d", "365d"] as const;

/** What every window flag accepts, for the help texts. */
export const WINDOW_VALUE_HELP =
  "ISO-8601 (2026-11-10T09:00:00Z), epoch ms, a date (2026-11-10), today, yesterday, now, or a lookback (30m, 12h, 7d, 2w, 3mo). Dates, today and yesterday are midnight in this machine's time zone";

export const startDateHelp = (): string =>
  `Window start. ${WINDOW_VALUE_HELP}. Default: ${DEFAULT_LOOKBACK} ago`;

export const endDateHelp = (): string =>
  "Window end, same values as --start-date. A date, today or yesterday ends at the end of that day. Default: now";

export const SINCE_HELP = `Shorthand for --start-date up to now, e.g. --since 30d or --since yesterday. Default: ${DEFAULT_LOOKBACK}`;

type Bound = "start" | "end";

const DURATION =
  /^(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|mo|mos|months?|y|years?)(?:\s+ago)?$/i;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

/** The canonical unit a spelled-out unit stands for. */
const canonicalUnit = (unit: string): "m" | "h" | "d" | "w" | "mo" | "y" => {
  const lower = unit.toLowerCase();
  if (lower.startsWith("mo")) return "mo";
  if (lower.startsWith("mi") || lower === "m") return "m";
  if (lower.startsWith("h")) return "h";
  if (lower.startsWith("d")) return "d";
  if (lower.startsWith("w")) return "w";
  return "y";
};

/** `now` minus a lookback like `7d` or `3mo`, or null when it is not one. */
export const lookbackStart = ({ value, now }: { value: string; now: number }): number | null => {
  const match = DURATION.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const unit = canonicalUnit(match[2]!);
  if (unit === "mo" || unit === "y") {
    // Calendar months: "3mo" on 31 May is 28 Feb, not 90 days back.
    const date = new Date(now);
    date.setMonth(date.getMonth() - (unit === "y" ? amount * 12 : amount));
    return date.getTime();
  }
  return now - amount * UNIT_MS[unit]!;
};

/** Local midnight of the given day, `offsetDays` later, or null for a day that does not exist. */
const localMidnight = ({
  year,
  month,
  day,
  offsetDays = 0,
}: {
  year: number;
  month: number;
  day: number;
  offsetDays?: number;
}): number | null => {
  // A day that does not exist (2026-02-30) rolls over; reading it back says so.
  const exact = new Date(year, month - 1, day);
  const readBack = `${exact.getFullYear()}-${exact.getMonth() + 1}-${exact.getDate()}`;
  if (readBack !== `${year}-${month}-${day}`) return null;
  return new Date(year, month - 1, day + offsetDays).getTime();
};

/** A day as a start bound is its midnight; as an end bound, the next midnight, never after now. */
const dayBound = ({
  date,
  bound,
  now,
}: {
  date: Date;
  bound: Bound;
  now: number;
}): number | null => {
  const ms = localMidnight({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    offsetDays: bound === "end" ? 1 : 0,
  });
  if (ms === null || bound === "start") return ms;
  return Math.min(ms, now);
};

/** One window flag value as epoch ms, or null when it is none of the accepted forms. */
export const parseWindowValue = ({
  value,
  bound,
  now,
}: {
  value: string;
  bound: Bound;
  now: number;
}): number | null => {
  const trimmed = value.trim();
  const word = trimmed.toLowerCase();
  if (word === "now") return now;
  if (word === "today") return dayBound({ date: new Date(now), bound, now });
  if (word === "yesterday") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return dayBound({ date, bound, now });
  }
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    // Date.parse reads a bare date as UTC midnight; a person means their own day.
    const start = localMidnight({
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
    });
    return start === null ? null : dayBound({ date: new Date(start), bound, now });
  }
  return lookbackStart({ value: trimmed, now }) ?? parseInstantOrNull(trimmed);
};

/** A window the caller can read back: where it starts and ends, and how it was chosen. */
export interface TimeWindow {
  from: number;
  to: number;
  /** True when the caller named any bound; false means the default lookback. */
  isExplicit: boolean;
}

export class TimeWindowError extends Error {}

/** Resolves the window flags, or throws a `TimeWindowError` naming the flag at fault. */
export const resolveTimeWindow = ({
  startDate,
  endDate,
  since,
  now,
  defaultLookback = DEFAULT_LOOKBACK,
}: {
  startDate?: string;
  endDate?: string;
  since?: string;
  now: number;
  defaultLookback?: string;
}): TimeWindow => {
  if (since !== undefined && startDate !== undefined) {
    throw new TimeWindowError("Pass --since or --start-date, not both: --since is a start date.");
  }
  const parse = (value: string, flag: string, bound: Bound): number => {
    const parsed = parseWindowValue({ value, bound, now });
    if (parsed === null) {
      throw new TimeWindowError(`Invalid ${flag} "${value}". Accepted: ${WINDOW_VALUE_HELP}.`);
    }
    return parsed;
  };
  const startValue = since ?? startDate;
  const startFlag = since !== undefined ? "--since" : "--start-date";
  const from =
    startValue !== undefined
      ? parse(startValue, startFlag, "start")
      : lookbackStart({ value: defaultLookback, now })!;
  const to = endDate !== undefined ? parse(endDate, "--end-date", "end") : now;
  if (from >= to) {
    throw new TimeWindowError(
      `The window is empty: ${startFlag} (${new Date(from).toISOString()}) is not before --end-date (${new Date(to).toISOString()}).`,
    );
  }
  return {
    from,
    to,
    isExplicit: startValue !== undefined || endDate !== undefined,
  };
};

/** Like `resolveTimeWindow`, but prints the refusal and exits 1. */
export const resolveTimeWindowOrExit = (
  input: Parameters<typeof resolveTimeWindow>[0],
): TimeWindow => {
  try {
    return resolveTimeWindow(input);
  } catch (error) {
    if (!(error instanceof TimeWindowError)) throw error;
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

/** The window as machine output carries it. */
export interface WindowDocument {
  from: string;
  to: string;
  /** The lookback used when the caller named no window, e.g. "7d". */
  lookback?: string;
  /** True when an empty default window was widened once before answering. */
  widened: boolean;
}

export const windowDocument = ({
  window,
  lookback,
  widened = false,
}: {
  window: TimeWindow;
  lookback?: string;
  widened?: boolean;
}): WindowDocument => ({
  from: new Date(window.from).toISOString(),
  to: new Date(window.to).toISOString(),
  ...(window.isExplicit || lookback === undefined ? {} : { lookback }),
  widened,
});

/** The next lookback that covers more than this window, or undefined past a year. */
export const widerLookback = ({ window }: { window: TimeWindow }): string | undefined => {
  const span = window.to - window.from;
  const now = window.to;
  return WIDER_LOOKBACKS.find((lookback) => now - lookbackStart({ value: lookback, now })! > span);
};

/** Quotes a value for a POSIX shell only when it needs it. */
export const shellQuote = (value: string): string =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

/** A command line from its words and flags, quoting values as a shell needs. */
export const commandLine = ({
  base,
  flags,
}: {
  base: string;
  flags: [flag: string, value: string | true | undefined][];
}): string =>
  [
    base,
    ...flags.flatMap(([flag, value]) => {
      if (value === undefined) return [];
      return value === true ? [flag] : [flag, shellQuote(value)];
    }),
  ].join(" ");
