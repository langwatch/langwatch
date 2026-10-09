import { analyticsComparisonWindow } from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

/** The start of the window the seven-day trend is compared against, as analytics reads it. */
export function previousPeriodStartMs({
  startMs,
  endMs,
}: {
  startMs: number;
  endMs: number;
}): number {
  return analyticsComparisonWindow({
    start: Temporal.Instant.fromEpochMilliseconds(startMs),
    end: Temporal.Instant.fromEpochMilliseconds(endMs),
  }).previousPeriodStart.epochMilliseconds;
}
