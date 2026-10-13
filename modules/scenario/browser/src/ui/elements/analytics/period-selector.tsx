import { DateRangePicker } from "@langwatch/design-system/date-range-picker";
import type { PopoverRootProps } from "@langwatch/design-system/popover";
import type { ButtonProps } from "@langwatch/design-system/primitives";
import { format, nowInstant, type Instant } from "@langwatch/time";

import {
  describePeriod,
  instantFromText,
  matchPeriodPreset,
  type Period,
  type PeriodMode,
  RELATIVE_PRESETS,
  type RelativePresetKey,
} from "../../../model/analytics/period.ts";

/** Where the range list opens, relative to the trigger. */
export type PeriodSelectorPlacement = NonNullable<
  NonNullable<PopoverRootProps["positioning"]>["placement"]
>;

const INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";

export function PeriodSelector({
  period,
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
  size = "sm",
  triggerVariant = "outline",
  placement = "bottom-end",
  triggerProps,
}: {
  period: Period;
  mode: PeriodMode;
  /**
   * Replaces the range shown on the trigger. For a surface that only filters
   * once a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: Instant, endDate: Instant) => void;
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
  /**
   * Spread onto the trigger button, for a surface that needs a test id or a
   * height the size scale does not offer.
   */
  triggerProps?: ButtonProps & { "data-testid"?: string };
}) {
  const { startDate, endDate } = period;

  return (
    <DateRangePicker
      presets={RELATIVE_PRESETS}
      activePresetKey={matchPeriodPreset({ period, mode })?.key}
      startValue={format(startDate.epochMilliseconds, INPUT_FORMAT)}
      endValue={format(endDate.epochMilliseconds, INPUT_FORMAT)}
      triggerLabel={label ?? describePeriod({ period, mode })}
      onStartChange={(text) => setPeriod(instantFromText(text, nowInstant()), endDate)}
      onEndChange={(text) => setPeriod(startDate, instantFromText(text, nowInstant()))}
      onPresetSelect={setRelativePeriod}
      onClear={clearPeriod}
      size={size}
      triggerVariant={triggerVariant}
      placement={placement}
      triggerProps={triggerProps}
    />
  );
}
