/**
 * The comparison window a period-over-period read is measured against. Pure
 * arithmetic over a request's own instants, so a peer computing "the window
 * before mine" needs no capability from this module, only this function.
 */
import { toZonedDateTime, type Instant } from "@langwatch/time";

export type AnalyticsComparisonWindow = Readonly<{
  previousPeriodStart: Instant;
  start: Instant;
  end: Instant;
  daysDifference: number;
}>;

/**
 * Where the window immediately before `start` begins.
 * @param periodMinutes A datapoint step, when the surface has one; one day otherwise
 */
export function analyticsComparisonWindow(
  input: Readonly<{ start: Instant; end: Instant }>,
  periodMinutes?: number,
): AnalyticsComparisonWindow {
  const startDay = toZonedDateTime(input.start.epochMilliseconds).toPlainDate();
  const endDay = toZonedDateTime(input.end.epochMilliseconds).toPlainDate();
  const calendarDays = endDay.since(startDay, { largestUnit: "day" }).days + 1;
  const periodInDays = periodMinutes === undefined ? 1 : Math.ceil(periodMinutes / (24 * 60));
  const daysDifference = Math.max(periodInDays, calendarDays);
  const previousPeriodStart = toZonedDateTime(input.start.epochMilliseconds)
    .subtract({ days: daysDifference })
    .toInstant();

  return { previousPeriodStart, start: input.start, end: input.end, daysDifference };
}
