/**
 * The control that picks the range every chart on the page is drawn over. The RENDERING half of
 * `platform/app/src/components/PeriodSelector.tsx`; the reading half is pure in
 * `model/analytics-period.ts` and bound in `behavior/use-analytics-period.ts`.
 */

import { DateRangePicker } from "@langwatch/design-system/date-range-picker";
import type { PopoverRootProps } from "@langwatch/design-system/popover";
import type { ButtonProps } from "@langwatch/design-system/primitives";
import { format, nowInstant, type Instant } from "@langwatch/time";

import {
  ANALYTICS_RELATIVE_PRESETS,
  instantFromText,
  presetForRange,
  type AnalyticsPeriod,
  type AnalyticsPeriodMode,
  type AnalyticsPresetKey,
} from "../../model/analytics-period.ts";

/** Where the range list opens, relative to the trigger. */
export type AnalyticsPeriodPickerPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

const INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";

export function AnalyticsPeriodPicker({
  period: { startDate, endDate },
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
  size: _size = "sm",
  triggerVariant: _triggerVariant = "outline",
  placement = "bottom-end",
}: {
  period: AnalyticsPeriod;
  mode: AnalyticsPeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Instant, endDate: Instant) => void;
  setRelativePeriod: (presetKey: AnalyticsPresetKey) => void;
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
  placement?: AnalyticsPeriodPickerPlacement;
}) {
  const matchedPreset = () => {
    if (mode !== "relative") return undefined;
    const minutes = Math.round((endDate.epochMilliseconds - startDate.epochMilliseconds) / 60000);
    const matchedByMinutes = ANALYTICS_RELATIVE_PRESETS.find(
      (preset) => preset.minutes === minutes,
    );
    if (matchedByMinutes) return matchedByMinutes;

    return presetForRange(startDate, endDate, nowInstant());
  };
  const preset = matchedPreset();

  return (
    <DateRangePicker
      presets={ANALYTICS_RELATIVE_PRESETS}
      activePresetKey={preset?.key}
      startValue={format(startDate.epochMilliseconds, INPUT_FORMAT)}
      endValue={format(endDate.epochMilliseconds, INPUT_FORMAT)}
      triggerLabel={
        label ??
        preset?.label ??
        `${format(startDate.epochMilliseconds, "MMM d")} - ${format(endDate.epochMilliseconds, "MMM d")}`
      }
      onStartChange={(text) => setPeriod(instantFromText(text, nowInstant()), endDate)}
      onEndChange={(text) => setPeriod(startDate, instantFromText(text, nowInstant()))}
      onPresetSelect={setRelativePeriod}
      onClear={clearPeriod}
      placement={placement}
    />
  );
}
