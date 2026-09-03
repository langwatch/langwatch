/**
 * The range every analytics read is scoped to, read out of the address.
 *
 * The reading half of `platform/app/src/components/PeriodSelector.tsx`, made
 * pure so "which window is a chart showing" is a unit test rather than
 * something only a mounted router can answer.
 *
 * PURE MEANS IT TAKES `now`, AND THAT IS A TRAP. A relative window ends at the
 * instant it is read, so calling this straight out of a render body gives a new
 * `endDate` every frame, to the millisecond — and every analytics query keys on
 * the two dates, so the page would refetch forever. `behavior/use-analytics-period.ts`
 * is the render seam that memoises it; the annotations family paid three hours
 * to find this the hard way and the pin beside it says so.
 */

import { differenceInCalendarDays, startOfDay, subDays } from "date-fns";

/** Date range used for time-based filtering across the analytics pages. */
export type AnalyticsPeriod = { startDate: Date; endDate: Date };

/**
 * Relative range presets. The key is what gets serialised into the address as
 * `?period=<key>`. `minutes` is the lookback window from "now".
 *
 * `days` is the equivalent inclusive day count exposed to consumers via
 * `daysDifference`. For sub-day windows it clamps to 1 — analytics queries
 * already do their own `Math.max` so this stays compatible.
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

export const analyticsDaysDifference = (startDate: Date, endDate: Date): number =>
  differenceInCalendarDays(endDate, startDate) + 1;

const isValidDateString = (dateString: string): boolean => {
  const parsed = new Date(dateString);
  return parsed instanceof Date && !isNaN(parsed.getTime());
};

/**
 * The [start, end] window a relative preset means, anchored to `now`.
 *
 * Day-based presets snap the start to start-of-day, which is what the day
 * quick selectors have always meant.
 */
export const computeRelativeWindow = (
  presetKey: AnalyticsPresetKey,
  now: Date,
): AnalyticsPeriod => {
  const preset = PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDay(subDays(now, 29)), endDate: now };
  }

  if (preset.minutes !== null) {
    return {
      startDate: new Date(now.getTime() - preset.minutes * 60 * 1000),
      endDate: now,
    };
  }

  return { startDate: startOfDay(subDays(now, preset.days - 1)), endDate: now };
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
  now: Date;
  defaultNDays?: number;
}): AnalyticsPeriodReading => {
  const startDate = query.startDate;
  const endDate = query.endDate;
  if (
    typeof startDate === "string" &&
    typeof endDate === "string" &&
    isValidDateString(startDate) &&
    isValidDateString(endDate)
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return {
      period: { startDate: start > end ? end : start, endDate: end },
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
  startDate: Date,
  endDate: Date,
  now: Date,
): (typeof ANALYTICS_RELATIVE_PRESETS)[number] | undefined => {
  if (analyticsDaysDifference(endDate, now) > 1) return void 0;
  const days = analyticsDaysDifference(startDate, endDate);
  return ANALYTICS_RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === days,
  );
};
