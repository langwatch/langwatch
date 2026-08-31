/**
 * The comparison window a period-over-period read is measured against,
 * derived from the same shared filter input the read itself parses.
 *
 * It sits beside the router root rather than under `server/analytics/` because
 * its one caller is the internal monitor router: this is API-layer arithmetic
 * over a request's own dates, not part of the analytics engine. The analytics
 * package is its eventual home — the function needs only `startDate` and
 * `endDate`, not the application's filter schema — and moving it there is an
 * analytics drain rather than a router one.
 */

import { addDays, differenceInCalendarDays } from "date-fns";

import type { z } from "zod";
import type { sharedFiltersInputSchema } from "../analytics/types";

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

export const currentVsPreviousDates = (
  input: z.infer<typeof sharedFiltersInputSchema>,
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
