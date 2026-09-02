/**
 * The comparison window a period-over-period read is measured against.
 *
 * Arithmetic over a request's own dates and nothing else: it takes a start and
 * an end, and answers where the window immediately before them begins. It lives
 * with Analytics because it is what "compared to the previous period" means on
 * every analytics surface — the monitors page's performance strip reads the
 * same trend a person sees when they open analytics for that evaluation, and it
 * reads it by asking this.
 */
import { addDays, differenceInCalendarDays } from "date-fns";

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

export const currentVsPreviousDates = (
  input: Readonly<{ startDate: number | string | Date; endDate: number | string | Date }>,
  period?: number | string,
) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);

  // Convert period from minutes to days if it's a number
  const periodInDays =
    typeof period === "number"
      ? period / (24 * 60) // Convert minutes to days
      : 1;

  const daysDifference = Math.max(periodInDays, getDaysDifference(startDate, endDate));
  const previousPeriodStartDate = addDays(startDate, -daysDifference);

  return { previousPeriodStartDate, startDate, endDate, daysDifference };
};
