import { nowInstant, Temporal } from "@langwatch/time";

export interface TimeRangePreset {
  id: string;
  label: string;
  shortLabel: string;
  compute: () => { from: number; to: number };
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function rolling(windowMs: number): () => { from: number; to: number } {
  return () => {
    const now = nowInstant().epochMilliseconds;
    return { from: now - windowMs, to: now };
  };
}

export const ROLLING_PRESETS: readonly TimeRangePreset[] = [
  {
    id: "15m",
    label: "Last 15 minutes",
    shortLabel: "15m",
    compute: rolling(15 * MS_PER_MINUTE),
  },
  {
    id: "1h",
    label: "Last 1 hour",
    shortLabel: "1h",
    compute: rolling(MS_PER_HOUR),
  },
  {
    id: "4h",
    label: "Last 4 hours",
    shortLabel: "4h",
    compute: rolling(4 * MS_PER_HOUR),
  },
  {
    id: "24h",
    label: "Last 24 hours",
    shortLabel: "24h",
    compute: rolling(MS_PER_DAY),
  },
  {
    id: "7d",
    label: "Last 7 days",
    shortLabel: "7d",
    compute: rolling(7 * MS_PER_DAY),
  },
  {
    id: "30d",
    label: "Last 30 days",
    shortLabel: "30d",
    compute: rolling(30 * MS_PER_DAY),
  },
  {
    id: "60d",
    label: "Last 60 days",
    shortLabel: "60d",
    compute: rolling(60 * MS_PER_DAY),
  },
];

export const CALENDAR_PRESETS: readonly TimeRangePreset[] = [
  {
    id: "wtd",
    label: "This week",
    shortLabel: "WTD",
    compute: () => {
      const now = Temporal.Now.zonedDateTimeISO();
      const start = now.subtract({ days: now.dayOfWeek - 1 }).startOfDay();
      return { from: start.epochMilliseconds, to: now.epochMilliseconds };
    },
  },
  {
    id: "mtd",
    label: "This month",
    shortLabel: "MTD",
    compute: () => {
      const now = Temporal.Now.zonedDateTimeISO();
      return {
        from: now.with({ day: 1 }).startOfDay().epochMilliseconds,
        to: now.epochMilliseconds,
      };
    },
  },
  {
    id: "qtd",
    label: "This quarter",
    shortLabel: "QTD",
    compute: () => {
      const now = Temporal.Now.zonedDateTimeISO();
      const quarterStartMonth = now.month - ((now.month - 1) % 3);
      return {
        from: now.with({ day: 1, month: quarterStartMonth }).startOfDay().epochMilliseconds,
        to: now.epochMilliseconds,
      };
    },
  },
];

export const ALL_PRESETS: readonly TimeRangePreset[] = [...ROLLING_PRESETS, ...CALENDAR_PRESETS];

export const PRESET_GROUPS: readonly {
  label: string;
  presets: readonly TimeRangePreset[];
}[] = [
  { label: "Rolling", presets: ROLLING_PRESETS },
  { label: "Period to date", presets: CALENDAR_PRESETS },
];

/**
 * Every preset by its id. A map rather than a lookup function: a contract
 * answers with data, and an id the picker does not offer is the caller's
 * absence to name (`preset_unknown` for the Explorer's transforms).
 */
export const PRESETS_BY_ID: Readonly<Record<string, TimeRangePreset>> = Object.fromEntries(
  ALL_PRESETS.map((preset) => [preset.id, preset]),
);

export const PRESET_MATCH_TOLERANCE_MS = MS_PER_MINUTE;
