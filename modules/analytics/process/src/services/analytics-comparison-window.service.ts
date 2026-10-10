/**
 * The comparison window a period-over-period read is measured against. Arithmetic over a
 * request's own dates and nothing else: it takes a start and an end, and answers where the
 * window immediately before them begins.
 */
import {
  currentTimeZone,
  differenceInCalendarDays,
  Temporal,
  toEpochMs,
  type Instant,
} from "@langwatch/time";

const getDaysDifference = (startDate: Instant, endDate: Instant) =>
  differenceInCalendarDays(endDate.epochMilliseconds, startDate.epochMilliseconds) + 1;

const toInstant = (value: number | string | Instant): Instant =>
  typeof value === "object" ? value : Temporal.Instant.fromEpochMilliseconds(toEpochMs(value));

/** The comparison window a period-over-period read is measured against. */
export class AnalyticsComparisonWindowService {
  static create(): AnalyticsComparisonWindowService {
    return new AnalyticsComparisonWindowService();
  }

  private constructor() {}

  /**
   * Where the window immediately before `startDate` begins.
   * @param period Minutes, when the surface has a datapoint step; one day
   */
  currentVsPrevious(
    input: Readonly<{ startDate: number | string | Instant; endDate: number | string | Instant }>,
    period?: number | string,
  ): {
    previousPeriodStartDate: Instant;
    startDate: Instant;
    endDate: Instant;
    daysDifference: number;
  } {
    const startDate = toInstant(input.startDate);
    const endDate = toInstant(input.endDate);
    // Whole days, always: the step arrives in minutes and a sub-day step is a
    // fraction of one, which Temporal refuses outright rather than truncating
    // the way the retired library did.
    const periodInDays = typeof period === "number" ? Math.ceil(period / (24 * 60)) : 1;
    const daysDifference = Math.max(periodInDays, getDaysDifference(startDate, endDate));

    return {
      previousPeriodStartDate: startDate
        .toZonedDateTimeISO(currentTimeZone())
        .subtract({ days: daysDifference })
        .toInstant(),
      startDate,
      endDate,
      daysDifference,
    };
  }
}
