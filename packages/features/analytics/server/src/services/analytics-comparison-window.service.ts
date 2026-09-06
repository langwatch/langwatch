/**
 * The comparison window a period-over-period read is measured against. Arithmetic over a
 * request's own dates and nothing else: it takes a start and an end, and answers where the
 * window immediately before them begins.
 */
import { addDays, differenceInCalendarDays } from "@langwatch/time";

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

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
    input: Readonly<{ startDate: number | string | Date; endDate: number | string | Date }>,
    period?: number | string,
  ): {
    previousPeriodStartDate: Date;
    startDate: Date;
    endDate: Date;
    daysDifference: number;
  } {
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);
    const periodInDays = typeof period === "number" ? period / (24 * 60) : 1;
    const daysDifference = Math.max(periodInDays, getDaysDifference(startDate, endDate));

    return {
      previousPeriodStartDate: addDays(startDate, -daysDifference),
      startDate,
      endDate,
      daysDifference,
    };
  }
}
