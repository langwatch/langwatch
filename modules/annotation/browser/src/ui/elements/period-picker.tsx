/**
 * The range control at the head of every annotation list — rendering half of
 * the family-local period copy (`model/annotation-period.ts` holds presets
 * and address writes), copied from `PeriodSelector` since a migration forbids reuse.
 */

import { DateRangePicker } from "@langwatch/design-system/date-range-picker";
import { format, nowInstant, toDate, toZonedDateTime } from "@langwatch/time";

import {
  ANNOTATION_PERIOD_PRESETS,
  matchingPreset,
  type AnnotationPeriod,
  type AnnotationPeriodMode,
  type AnnotationPeriodMoment,
  type AnnotationPeriodPresetKey,
} from "../../model/annotation-period.ts";

export function PeriodPicker({
  period,
  mode,
  label,
  setPeriod,
  setRelativePeriod,
  clearPeriod,
}: {
  period: AnnotationPeriod;
  mode: AnnotationPeriodMode;
  /**
   * Replaces the range shown on the trigger. For a list that only filters once
   * a range is picked, so the control does not name a window it is not
   * applying.
   */
  label?: string;
  setPeriod: (startDate: AnnotationPeriodMoment, endDate: AnnotationPeriodMoment) => void;
  setRelativePeriod: (presetKey: AnnotationPeriodPresetKey) => void;
  /**
   * Takes the range back off, offered as "All time". Only lists that show
   * everything without a range have somewhere to go back to, so the entry
   * appears only when they pass this.
   */
  clearPeriod?: () => void;
}) {
  const { startDate, endDate } = period;
  const preset =
    mode === "relative" ? matchingPreset({ period, now: toDate(nowInstant()) }) : undefined;

  return (
    <DateRangePicker
      presets={ANNOTATION_PERIOD_PRESETS}
      activePresetKey={preset?.key}
      startValue={format(startDate, "yyyy-MM-dd'T'HH:mm")}
      endValue={format(endDate, "yyyy-MM-dd'T'HH:mm")}
      triggerLabel={
        label ?? preset?.label ?? `${format(startDate, "MMM d")} - ${format(endDate, "MMM d")}`
      }
      onStartChange={(text) => setPeriod(toDate(toZonedDateTime(text)), endDate)}
      onEndChange={(text) => setPeriod(startDate, toDate(toZonedDateTime(text)))}
      onPresetSelect={setRelativePeriod}
      onClear={clearPeriod}
    />
  );
}
