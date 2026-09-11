/**
 * The two time chips every governance page carries, and the one rule between
 * them.
 *
 * Governance is read at a governance cadence: budgets are set by quarter and
 * headcount by year, so the shortest span worth offering is a quarter's worth
 * of months and the finest bucket is a month. That is the whole reason these
 * options differ from the trace explorer's, which is read in minutes.
 *
 * Time Frame is HOW FAR BACK the page looks. Time Interval is HOW WIDE each
 * bucket is. An interval wider than the frame would draw a chart with one bar
 * on it, so it is offered as disabled rather than removed — a chip whose
 * options change under the reader teaches nothing about why.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */

export type TimeInterval = "month" | "quarter" | "year";

export const TIME_INTERVALS: ReadonlyArray<{
  value: TimeInterval;
  label: string;
}> = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

export const DEFAULT_TIME_INTERVAL: TimeInterval = "quarter";

export type TimeFrame =
  | "last_3_months"
  | "last_12_months"
  | "year_to_date"
  | "last_2_years";

/**
 * `approximateDays` is for the reads underneath, which take a window in days.
 * It is an approximation on purpose: nothing on these pages is billed off it,
 * and a frame whose length shifted with the month would move every chart under
 * a reader who changed nothing.
 */
export const TIME_FRAMES: ReadonlyArray<{
  value: TimeFrame;
  label: string;
  approximateDays: number;
}> = [
  { value: "last_3_months", label: "Last 3 months", approximateDays: 90 },
  { value: "last_12_months", label: "Last 12 months", approximateDays: 365 },
  { value: "year_to_date", label: "Year to date", approximateDays: 365 },
  { value: "last_2_years", label: "Last 2 years", approximateDays: 730 },
];

export const DEFAULT_TIME_FRAME: TimeFrame = "last_12_months";

/** Rough span of each interval, only ever compared against another of these. */
const INTERVAL_DAYS: Record<TimeInterval, number> = {
  month: 30,
  quarter: 91,
  year: 365,
};

/**
 * Whether an interval is too wide for the frame in view — the condition that
 * disables its menu item.
 *
 * A quarter interval over a three-month frame draws exactly one bar, which is
 * a number wearing a chart's clothes, so it counts as too wide. Year to date
 * is the awkward one: it is a year long in December and three weeks long in
 * January, so it is measured by the day it is read on rather than by its name.
 */
export function isIntervalCoarserThanFrame({
  interval,
  frame,
  now = new Date(),
}: {
  interval: TimeInterval;
  frame: TimeFrame;
  /** Injected so the year-to-date case is testable on a fixed day. */
  now?: Date;
}): boolean {
  return INTERVAL_DAYS[interval] > frameSpanDays({ frame, now });
}

/** How many days the frame actually covers today. */
export function frameSpanDays({
  frame,
  now = new Date(),
}: {
  frame: TimeFrame;
  now?: Date;
}): number {
  if (frame !== "year_to_date") {
    return (
      TIME_FRAMES.find((option) => option.value === frame)?.approximateDays ??
      365
    );
  }
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const elapsedMs = now.getTime() - startOfYear;
  return Math.max(1, Math.floor(elapsedMs / 86_400_000) + 1);
}

/**
 * The interval to actually render with, given the frame in view.
 *
 * A reader on Quarter who narrows the frame to three months has an interval
 * the new frame cannot draw. Rather than leaving a disabled value selected,
 * every page steps down to the widest interval that still fits — the same
 * answer on every page, which is the point of it living here.
 */
export function coerceInterval({
  interval,
  frame,
  now = new Date(),
}: {
  interval: TimeInterval;
  frame: TimeFrame;
  now?: Date;
}): TimeInterval {
  if (!isIntervalCoarserThanFrame({ interval, frame, now })) return interval;
  const widestThatFits = [...TIME_INTERVALS]
    .reverse()
    .find(
      (option) =>
        !isIntervalCoarserThanFrame({ interval: option.value, frame, now }),
    );
  return widestThatFits?.value ?? "month";
}

/** The label a chip shows for the current choice. */
export function timeFrameLabel(frame: TimeFrame): string {
  return (
    TIME_FRAMES.find((option) => option.value === frame)?.label ??
    "Last 12 months"
  );
}

/** The label a chip shows for the current interval. */
export function timeIntervalLabel(interval: TimeInterval): string {
  return (
    TIME_INTERVALS.find((option) => option.value === interval)?.label ??
    "Quarter"
  );
}
