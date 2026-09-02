/**
 * The date range these lists read, as data.
 *
 * A FAMILY-LOCAL COPY of the reading half of
 * `platform/app/src/components/PeriodSelector.tsx`, which keeps thirty callers
 * across the application and so did not travel. Deletes-only forbids repointing
 * any of them, and the Design System publishes no period control.
 *
 * The split is deliberate and is what the platform module did not have: the
 * presets, the window they resolve to and the two address writes are pure
 * functions here, and the popover that renders them is
 * `ui/elements/period-picker.tsx`. That is what lets "the queue list does not
 * narrow until a range is picked" — the rule the Inbox badge and the list
 * depend on agreeing about — be a unit test rather than a rendered assertion.
 *
 * NARROWED: the platform hook also answers `daysDifference`, which the
 * analytics surfaces read and no annotation list does.
 */

import { differenceInCalendarDays, startOfDay, subDays } from "date-fns";

/** Date range used for time-based filtering. */
export type AnnotationPeriod = { startDate: Date; endDate: Date };

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

const isValidDateString = (value: string) => !Number.isNaN(new Date(value).getTime());

const daysBetween = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

/**
 * The window a preset resolves to, anchored to `now`.
 *
 * Day-based presets snap the start to start-of-day, which is what the day quick
 * selectors have always done.
 */
export function computeRelativeWindow(
  presetKey: AnnotationPeriodPresetKey,
  now: Date,
): AnnotationPeriod {
  const preset = PRESETS_BY_KEY.get(presetKey);
  if (!preset) return { startDate: startOfDay(subDays(now, 29)), endDate: now };
  if (preset.minutes !== null) {
    return { startDate: new Date(now.getTime() - preset.minutes * 60_000), endDate: now };
  }
  return { startDate: startOfDay(subDays(now, preset.days - 1)), endDate: now };
}

export type AnnotationPeriodReading = {
  period: AnnotationPeriod;
  mode: AnnotationPeriodMode;
  /**
   * True while the address carries no range of its own, so `period` is this
   * module's own fallback rather than something the reviewer asked for.
   *
   * THE QUEUE LISTS DEPEND ON THIS. A queue is work still to do and the sidebar
   * badge counts all of it, so a default window that quietly dropped older
   * items would leave the badge and the list disagreeing. They narrow the read
   * only once a range has actually been picked.
   */
  isDefault: boolean;
};

/** The range the address names, or the thirty-day fallback when it names none. */
export function readAnnotationPeriod({
  query,
  now,
}: {
  query: Readonly<Record<string, string | undefined>>;
  now: Date;
}): AnnotationPeriodReading {
  const start = query.startDate;
  const end = query.endDate;
  if (start && end && isValidDateString(start) && isValidDateString(end)) {
    const startDate = new Date(start);
    const endDate = new Date(end);
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
  startDate: Date;
  endDate: Date;
}): Record<string, string | undefined> {
  const safeEnd = Number.isNaN(endDate.getTime()) ? new Date() : endDate;
  const candidate = Number.isNaN(startDate.getTime()) ? new Date() : startDate;
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
 * The preset a window matches, for the trigger's label.
 *
 * MOVED AS IT IS, quirk included. A day-span match is tried first and only when
 * the window ends within a day of now; the minute-span match behind it is
 * therefore unreachable for every preset this module offers, because every
 * sub-day preset also spans one calendar day and so matches `today` on the way
 * past. So a fifteen-minute window is labelled "Today" — which is what
 * `platform/app` has always labelled it, and changing which of two presets wins
 * is a behaviour change a page move does not own. The test says so out loud
 * rather than asserting the label somebody would expect.
 */
export function matchingPreset({
  period,
  now,
}: {
  period: AnnotationPeriod;
  now: Date;
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
