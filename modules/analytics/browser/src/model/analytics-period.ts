/**
 * The range every analytics read is scoped to. Pure means it takes `now`
 * — calling this straight from a render body gives a new `endDate` every
 * frame; `behavior/use-analytics-period.ts` is the render seam that memoises it.
 */

import {
  currentTimeZone,
  differenceInCalendarDays,
  Temporal,
  toEpochMs,
  type Instant,
} from "@langwatch/time";

/** Date range used for time-based filtering across the analytics pages. */
export type AnalyticsPeriod = { startDate: Instant; endDate: Instant };

/**
 * Relative range presets: the key serialises into the address as
 * `?period=<key>`; `days` is the inclusive day count for `daysDifference`,
 * clamped to 1 for sub-day windows since queries already `Math.max` it.
 */
export const ANALYTICS_RELATIVE_PRESETS = [
  { key: "15m", label: "Last 15 minutes", minutes: 15, days: 1 },
  { key: "1h", label: "Last 1 hour", minutes: 60, days: 1 },
  { key: "6h", label: "Last 6 hours", minutes: 60 * 6, days: 1 },
  { key: "24h", label: "Last 24 hours", minutes: 60 * 24, days: 1 },
  { key: "today", label: "Today", minutes: null, days: 1 },
  { key: "7d", label: "Last 7 days", minutes: null, days: 7 },
  { key: "15d", label: "Last 15 days", minutes: null, days: 15 },
  { key: "30d", label: "Last 30 days", minutes: null, days: 30 },
  { key: "90d", label: "Last 90 days", minutes: null, days: 90 },
  { key: "6mo", label: "Last 6 months", minutes: null, days: 180 },
  { key: "1y", label: "Last 1 year", minutes: null, days: 365 },
] as const;

export type AnalyticsPresetKey = (typeof ANALYTICS_RELATIVE_PRESETS)[number]["key"];

export type AnalyticsPeriodMode = "relative" | "absolute";

const PRESETS_BY_KEY = new Map(ANALYTICS_RELATIVE_PRESETS.map((preset) => [preset.key, preset]));

export const isAnalyticsPresetKey = (value: unknown): value is AnalyticsPresetKey =>
  typeof value === "string" && PRESETS_BY_KEY.has(value as AnalyticsPresetKey);

export const analyticsDaysDifference = (startDate: Instant, endDate: Instant): number =>
  differenceInCalendarDays(endDate.epochMilliseconds, startDate.epochMilliseconds) + 1;

const startOfDayDaysBefore = (now: Instant, days: number): Instant =>
  now.toZonedDateTimeISO(currentTimeZone()).subtract({ days }).startOfDay().toInstant();

const epochMsOf = (value: string | undefined): number =>
  typeof value === "string" ? toEpochMs(value) : Number.NaN;

/** A moment typed into a field, or `fallback` when the field does not hold one. */
export const instantFromText = (text: string, fallback: Instant): Instant => {
  const epochMs = toEpochMs(text);
  return Number.isFinite(epochMs) ? Temporal.Instant.fromEpochMilliseconds(epochMs) : fallback;
};

/**
 * The [start, end] window a relative preset means, anchored to `now`.
 * Day-based presets snap the start to start-of-day, which is what the
 * day quick selectors have always meant.
 */
export const computeRelativeWindow = (
  presetKey: AnalyticsPresetKey,
  now: Instant,
): AnalyticsPeriod => {
  const preset = PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDayDaysBefore(now, 29), endDate: now };
  }

  if (preset.minutes !== null) {
    return { startDate: now.subtract({ minutes: preset.minutes }), endDate: now };
  }

  return { startDate: startOfDayDaysBefore(now, preset.days - 1), endDate: now };
};

const defaultPresetForDays = (defaultNDays: number): AnalyticsPresetKey =>
  ANALYTICS_RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === defaultNDays,
  )?.key ?? "30d";

export type AnalyticsPeriodReading = {
  period: AnalyticsPeriod;
  mode: AnalyticsPeriodMode;
  /**
   * True while the address carries no range of its own, so `period` is the
   * fallback rather than something the reader asked for.
   */
  isDefault: boolean;
};

/** The window the address asks for, or the default one when it asks for none. */
export const readAnalyticsPeriod = ({
  query,
  now,
  defaultNDays = 30,
}: {
  query: Readonly<Record<string, string | undefined>>;
  now: Instant;
  defaultNDays?: number;
}): AnalyticsPeriodReading => {
  const startMs = epochMsOf(query.startDate);
  const endMs = epochMsOf(query.endDate);
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    const end = Temporal.Instant.fromEpochMilliseconds(endMs);
    return {
      period: {
        startDate: startMs > endMs ? end : Temporal.Instant.fromEpochMilliseconds(startMs),
        endDate: end,
      },
      mode: "absolute",
      isDefault: false,
    };
  }

  const candidate = query.period;
  const picked = isAnalyticsPresetKey(candidate);
  const presetKey: AnalyticsPresetKey = picked ? candidate : defaultPresetForDays(defaultNDays);
  return {
    period: computeRelativeWindow(presetKey, now),
    mode: "relative",
    isDefault: !picked,
  };
};

/** The preset a shown range corresponds to, for labelling the trigger. */
export const presetForRange = (
  startDate: Instant,
  endDate: Instant,
  now: Instant,
): (typeof ANALYTICS_RELATIVE_PRESETS)[number] | undefined => {
  if (analyticsDaysDifference(endDate, now) > 1) return void 0;
  const days = analyticsDaysDifference(startDate, endDate);
  return ANALYTICS_RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === days,
  );
};
