import { DateRangePicker } from "@langwatch/design-system/date-range-picker";
import type { PopoverRootProps } from "@langwatch/design-system/popover";
import type { ButtonProps } from "@langwatch/design-system/primitives";
import {
  differenceInCalendarDays,
  format,
  nowInstant,
  startOfDay,
  subDays,
  toEpochMs,
  type TimeInput,
  readableDate,
} from "@langwatch/time";

import type { Period, PeriodMode } from "../../model/session-filters.ts";
import { type ReadableDate } from "../../model/short-date.ts";

/**
 * The date-range control the activity tables narrow by. A copy of the old
 * `PeriodSelector`, controlled-only: tables hold the range in their own
 * state, not the query string, which a feature-web package may not touch.
 */

/**
 * Relative range presets. The key is what a caller names a preset by;
 * `minutes` is the lookback window from "now", and `days` the equivalent
 * inclusive day count, clamped to 1 for sub-day windows.
 */
const RELATIVE_PRESETS = [
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

const getDaysDifference = (startDate: TimeInput, endDate: TimeInput) =>
  differenceInCalendarDays(endDate, startDate) + 1;

/**
 * The [start, end] window for a relative preset, anchored to `now`.
 * Day-based presets snap the start to start-of-day, matching the day quick
 * selectors elsewhere in the product.
 */
export const computeRelativeWindow = (presetKey: RelativePresetKey, now: TimeInput): Period => {
  const preset = RELATIVE_PRESETS_BY_KEY.get(presetKey);
  if (!preset) {
    return { startDate: startOfDay(subDays(now, 29)), endDate: readableDate(now) };
  }

  if (preset.minutes !== null) {
    const startDate = readableDate(toEpochMs(now) - preset.minutes * 60 * 1000);
    return { startDate, endDate: readableDate(now) };
  }

  const startDate = startOfDay(subDays(now, preset.days - 1));
  return { startDate, endDate: readableDate(now) };
};

const getPresetForRange = (
  startDate: TimeInput,
  endDate: TimeInput,
  now: TimeInput,
): (typeof RELATIVE_PRESETS)[number] | undefined => {
  const daysDifference = getDaysDifference(startDate, endDate);
  const daysFromToday = getDaysDifference(endDate, now);
  if (daysFromToday > 1) return void 0;

  return RELATIVE_PRESETS.find(
    (preset) => preset.minutes === null && preset.days === daysDifference,
  );
};

/** Where the range list opens, relative to the trigger. */
export type PeriodSelectorPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

export function PeriodSelector({
  period: { startDate, endDate },
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
  size = "sm",
  triggerVariant = "outline",
  placement = "bottom-end",
}: {
  period: Period;
  mode: PeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: ReadableDate, endDate: ReadableDate) => void;
  setRelativePeriod: (presetKey: RelativePresetKey) => void;
  /**
   * Takes the range back off, offered as "All time". Only surfaces that show
   * everything without a range have somewhere to go back to, so the entry
   * appears only when they pass this.
   */
  clearPeriod?: () => void;
  /** The size of the trigger. A rail foot wants "xs". */
  size?: ButtonProps["size"];
  /** The look of the trigger. A rail foot wants "ghost". */
  triggerVariant?: ButtonProps["variant"];
  /** Where the range list opens. A control at the foot of a rail wants "top-start". */
  placement?: PeriodSelectorPlacement;
}) {
  const matchedPreset = () => {
    if (mode !== "relative") return undefined;
    const minutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const matchedByMinutes = RELATIVE_PRESETS.find((preset) => preset.minutes === minutes);
    if (matchedByMinutes) return matchedByMinutes;

    return getPresetForRange(startDate, endDate, nowInstant().epochMilliseconds);
  };
  const preset = matchedPreset();

  return (
    <DateRangePicker
      presets={RELATIVE_PRESETS}
      activePresetKey={preset?.key}
      startValue={format(startDate, "yyyy-MM-dd'T'HH:mm")}
      endValue={format(endDate, "yyyy-MM-dd'T'HH:mm")}
      triggerLabel={
        label ?? preset?.label ?? `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`
      }
      onStartChange={(text) => setPeriod(readableDate(text), endDate)}
      onEndChange={(text) => setPeriod(startDate, readableDate(text))}
      onPresetSelect={setRelativePeriod}
      onClear={clearPeriod}
      size={size}
      triggerVariant={triggerVariant}
      placement={placement}
    />
  );
}
