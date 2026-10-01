/**
 * The date range these lists read, as data: presets, the window a preset
 * resolves to, and the address that carries a range. Pure, so the rules are unit tests.
 */

import type { ListAnnotationsInput } from "@langwatch/annotation-contract";
import {
  differenceInCalendarDays,
  fromDate,
  nowInstant,
  startOfDay,
  subDays,
  toDate,
  toEpochMs,
  toZonedDateTime,
  type TimeInput,
} from "@langwatch/time";

/** Date range used for time-based filtering, in the shape the list query sends. */
export type AnnotationPeriod = Required<Pick<ListAnnotationsInput, "startDate" | "endDate">>;

/** One end of a range, and the anchor every reading is taken against. */
export type AnnotationPeriodMoment = AnnotationPeriod["endDate"];

/** Whether the range is a named lookback or two picked timestamps. */
export type AnnotationPeriodMode = "relative" | "absolute";

/**
 * Relative range presets. The key is what gets serialised into the address as
 * `?period=<key>`. `minutes` is the lookback window from "now"; a `null`
 * `minutes` means the preset counts whole days and snaps to start-of-day.
 */
export const ANNOTATION_PERIOD_PRESETS = [
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

export type AnnotationPeriodPresetKey = (typeof ANNOTATION_PERIOD_PRESETS)[number]["key"];

const PRESETS_BY_KEY = new Map(ANNOTATION_PERIOD_PRESETS.map((preset) => [preset.key, preset]));

const isPresetKey = (value: unknown): value is AnnotationPeriodPresetKey =>
  typeof value === "string" && PRESETS_BY_KEY.has(value as AnnotationPeriodPresetKey);

const isValidDateString = (value: string) => !Number.isNaN(toEpochMs(value));

const daysBetween = (startDate: TimeInput, endDate: TimeInput) =>
  differenceInCalendarDays(endDate, startDate) + 1;

/** The window a preset resolves to, anchored to `now`; day presets start at start-of-day. */
export function computeRelativeWindow(
  presetKey: AnnotationPeriodPresetKey,
  now: AnnotationPeriodMoment,
): AnnotationPeriod {
  const preset = PRESETS_BY_KEY.get(presetKey);
  if (!preset) return { startDate: startOfDay(subDays(now, 29)), endDate: now };

  if (preset.minutes !== null) {
    return {
      startDate: toDate(fromDate(now).subtract({ milliseconds: preset.minutes * 60_000 })),
      endDate: now,
    };
  }

  return { startDate: startOfDay(subDays(now, preset.days - 1)), endDate: now };
}

export type AnnotationPeriodReading = {
  period: AnnotationPeriod;
  mode: AnnotationPeriodMode;
  /**
   * True while the address carries no range, so `period` is the fallback and the
   * queue lists do not narrow their read yet.
   */
  isDefault: boolean;
};

/** The range the address names, or the thirty-day fallback when it names none. */
export function readAnnotationPeriod({
  query,
  now,
}: {
  query: Readonly<Record<string, string | undefined>>;
  now: AnnotationPeriodMoment;
}): AnnotationPeriodReading {
  const start = query.startDate;
  const end = query.endDate;

  if (start && end && isValidDateString(start) && isValidDateString(end)) {
    const startDate = toDate(toZonedDateTime(start));
    const endDate = toDate(toZonedDateTime(end));

    return {
      period: { startDate: startDate > endDate ? endDate : startDate, endDate },
      mode: "absolute",
      isDefault: false,
    };
  }

  const named = query.period;
  const picked = isPresetKey(named);
  const presetKey: AnnotationPeriodPresetKey = picked ? named : "30d";

  return {
    period: computeRelativeWindow(presetKey, now),
    mode: "relative",
    isDefault: !picked,
  };
}

/** Two picked timestamps, replacing whatever preset the address carried. */
export function absolutePeriodAddress({
  current,
  startDate,
  endDate,
}: {
  current: Readonly<Record<string, string | undefined>>;
  startDate: AnnotationPeriodMoment;
  endDate: AnnotationPeriodMoment;
}): Record<string, string | undefined> {
  const safeEnd = Number.isNaN(endDate.getTime()) ? toDate(nowInstant()) : endDate;
  const candidate = Number.isNaN(startDate.getTime()) ? toDate(nowInstant()) : startDate;
  const safeStart = candidate > safeEnd ? safeEnd : candidate;

  return {
    ...current,
    period: void 0,
    startDate: safeStart.toISOString(),
    endDate: safeEnd.toISOString(),
  };
}

/** A named lookback, replacing whatever timestamps the address carried. */
export function relativePeriodAddress({
  current,
  presetKey,
}: {
  current: Readonly<Record<string, string | undefined>>;
  presetKey: AnnotationPeriodPresetKey;
}): Record<string, string | undefined> {
  return { ...current, startDate: void 0, endDate: void 0, period: presetKey };
}

/** Takes the range back off, which is what "All time" means. */
export function clearedPeriodAddress(
  current: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return { ...current, period: void 0, startDate: void 0, endDate: void 0 };
}

/**
 * The preset a window matches, for the trigger's label. The day-span match runs
 * first, so a sub-day window ending now labels as "Today".
 */
export function matchingPreset({
  period,
  now,
}: {
  period: AnnotationPeriod;
  now: AnnotationPeriodMoment;
}): (typeof ANNOTATION_PERIOD_PRESETS)[number] | undefined {
  const span = daysBetween(period.startDate, period.endDate);

  const byDays =
    daysBetween(period.endDate, now) > 1
      ? void 0
      : ANNOTATION_PERIOD_PRESETS.find((preset) => preset.minutes === null && preset.days === span);

  if (byDays) return byDays;

  const minutes = Math.round((period.endDate.getTime() - period.startDate.getTime()) / 60_000);

  return ANNOTATION_PERIOD_PRESETS.find((preset) => preset.minutes === minutes);
}
