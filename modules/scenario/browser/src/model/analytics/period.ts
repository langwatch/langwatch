import {
  currentTimeZone,
  differenceInCalendarDays,
  format,
  nowInstant,
  Temporal,
  toEpochMs,
  type Instant,
} from "@langwatch/time";

/** Date range used for time-based filtering across the app. */
export type Period = { startDate: Instant; endDate: Instant };

/**
 * Relative range presets. The key is what gets serialised into the URL as `?period=<key>`.
 * `minutes` is the lookback window from "now". `days` is the equivalent inclusive day count
 * exposed to consumers via `daysDifference`.
 */
export const RELATIVE_PRESETS = [
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

export type RelativePresetKey = (typeof RELATIVE_PRESETS)[number]["key"];

const RELATIVE_PRESETS_BY_KEY = new Map(RELATIVE_PRESETS.map((preset) => [preset.key, preset]));

export const isRelativePresetKey = (value: unknown): value is RelativePresetKey =>
  typeof value === "string" && RELATIVE_PRESETS_BY_KEY.has(value as RelativePresetKey);

export const getDaysDifference = (startDate: Instant, endDate: Instant) =>
  differenceInCalendarDays(endDate.epochMilliseconds, startDate.epochMilliseconds) + 1;

const startOfDayDaysBefore = (now: Instant, days: number): Instant =>
  now.toZonedDateTimeISO(currentTimeZone()).subtract({ days }).startOfDay().toInstant();

/** A moment read leniently from text, or `fallback` when the text does not hold one. */
export const instantFromText = (text: string, fallback: Instant): Instant => {
  const epochMs = toEpochMs(text);
  return Number.isFinite(epochMs) ? Temporal.Instant.fromEpochMilliseconds(epochMs) : fallback;
};

/**
 * Compute the [start, end] window for a relative preset, anchored to `now`.
 * Day-based presets snap the start to start-of-day to match the historical
 * behaviour of the day quick selectors.
 */
export const computeRelativeWindow = (presetKey: RelativePresetKey, now: Instant): Period => {
  const preset = RELATIVE_PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDayDaysBefore(now, 29), endDate: now };
  }

  if (preset.minutes !== null) {
    return { startDate: now.subtract({ minutes: preset.minutes }), endDate: now };
  }

  return { startDate: startOfDayDaysBefore(now, preset.days - 1), endDate: now };
};

const defaultPresetForDays = (defaultNDays: number): RelativePresetKey => {
  const match = RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === defaultNDays,
  );
  return match?.key ?? "30d";
};

export type PeriodMode = "relative" | "absolute";

/** An absolute range in the address wins; otherwise a relative preset does. */
export function readPeriodFromAddress({
  defaultNDays,
  now,
  queryEndDate,
  queryPeriod,
  queryStartDate,
}: {
  defaultNDays: number;
  now: Instant;
  queryEndDate: unknown;
  queryPeriod: unknown;
  queryStartDate: unknown;
}): { period: Period; mode: PeriodMode; isDefault: boolean } {
  const startMs = typeof queryStartDate === "string" ? toEpochMs(queryStartDate) : Number.NaN;
  const endMs = typeof queryEndDate === "string" ? toEpochMs(queryEndDate) : Number.NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    const endDate = Temporal.Instant.fromEpochMilliseconds(endMs);
    const safeStart = startMs > endMs ? endDate : Temporal.Instant.fromEpochMilliseconds(startMs);

    return { period: { startDate: safeStart, endDate }, mode: "absolute", isDefault: false };
  }

  const picked = isRelativePresetKey(queryPeriod);
  const presetKey = picked ? queryPeriod : defaultPresetForDays(defaultNDays);

  return { period: computeRelativeWindow(presetKey, now), mode: "relative", isDefault: !picked };
}

const getPresetForRange = (
  startDate: Instant,
  endDate: Instant,
  now: Instant,
): (typeof RELATIVE_PRESETS)[number] | undefined => {
  const daysDifference = getDaysDifference(startDate, endDate);
  const daysFromToday = getDaysDifference(endDate, now);
  if (daysFromToday > 1) return undefined;

  return RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === daysDifference,
  );
};

/**
 * The preset a window matches, by whole days or by a sub-day minute span.
 * Undefined for a window that matches no preset, which is any free range.
 */
export const matchPeriodPreset = ({
  period: { startDate, endDate },
  mode,
}: {
  period: Period;
  mode: PeriodMode;
}): (typeof RELATIVE_PRESETS)[number] | undefined => {
  if (mode !== "relative") return undefined;

  const matchedByDays = getPresetForRange(startDate, endDate, nowInstant());
  if (matchedByDays) return matchedByDays;

  const minutes = Math.round((endDate.epochMilliseconds - startDate.epochMilliseconds) / 60000);
  return RELATIVE_PRESETS.find((preset) => preset.minutes === minutes);
};

/**
 * What the window is called, the way the trigger names it: the matched preset's own label, or
 * the start and end dates for a free range.
 */
export const describePeriod = ({ period, mode }: { period: Period; mode: PeriodMode }): string => {
  const preset = matchPeriodPreset({ period, mode });
  if (preset) return preset.label;

  return `${format(period.startDate.epochMilliseconds, "MMM d")} - ${format(period.endDate.epochMilliseconds, "MMM d")}`;
};
