/**
 * The window the Results tab reads, in the two forms the surface uses.
 *
 * The full form heads the Test Runs list. The compact form sits at the foot of
 * the runs rail and opens upwards, so the window stays reachable without
 * taking a line of the rail.
 *
 * Both forms are the shared {@link PeriodSelector}: the same presets and the
 * same free start and end dates as everywhere else in the app, so any window
 * can be read, not only the short ones.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { differenceInCalendarDays } from "date-fns";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import {
  describePeriod,
  matchPeriodPreset,
  PeriodSelector,
} from "~/components/PeriodSelector";
import { FG_MUTED } from "./design";

/**
 * How many days the window spans, counted the way the shared period control
 * counts them: a window that starts at the top of a day and ends now spans
 * both of those days.
 */
export function periodDays(period: Period): number {
  return differenceInCalendarDays(period.endDate, period.startDate) + 1;
}

/**
 * The window on the compact trigger: "30d", or the preset's own key for a
 * window shorter than a day ("15m"), which a day count cannot name.
 */
export function compactPeriodLabel(period: Period, mode: PeriodMode): string {
  const preset = matchPeriodPreset({ period, mode });
  if (preset?.minutes !== null && preset?.minutes !== undefined) {
    return preset.key;
  }

  const days = periodDays(period);
  return days >= 360 ? "1y" : `${days}d`;
}

export type AgentTestingPeriodPickerProps = {
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  /** The rail form: shorter, quieter, and opening upwards. */
  compact?: boolean;
};

/** The control that opens the range list, in its wide and its rail form. */
export function AgentTestingPeriodPicker({
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
  compact,
}: AgentTestingPeriodPickerProps) {
  return (
    <PeriodSelector
      period={period}
      mode={periodMode}
      setPeriod={setPeriod}
      setRelativePeriod={setRelativePeriod}
      size={compact ? "xs" : "sm"}
      triggerVariant={compact ? "ghost" : "outline"}
      placement={compact ? "top-start" : "bottom-end"}
      label={compact ? compactPeriodLabel(period, periodMode) : undefined}
      triggerProps={{
        "data-testid": "results-period-picker",
        // The trigger sits among controls that share one height and one type
        // size, so it takes theirs rather than the size scale's.
        ...(compact
          ? {
              // The compact trigger shows "15m" or "30d", so its accessible
              // name has to be the selector's own name for the window. A day
              // count would announce "Last 1 days" for a 15-minute range, or
              // "Last 2 days" for one that crosses midnight.
              "aria-label": describePeriod({ period, mode: periodMode }),
              title: describePeriod({ period, mode: periodMode }),
              height: "auto",
              paddingX: 1.5,
              paddingY: 1,
              fontSize: "11px",
              fontWeight: "medium",
              color: FG_MUTED,
            }
          : {
              height: "32px",
              fontSize: "12.5px",
              fontWeight: "medium",
              borderRadius: "lg",
              background: "bg.panel",
            }),
      }}
    />
  );
}
