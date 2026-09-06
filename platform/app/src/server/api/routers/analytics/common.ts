import { addDays, differenceInCalendarDays } from "date-fns";

import type { z } from "zod";
import type { sharedFiltersInputSchema } from "../../../analytics/types";

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

  const daysDifference = Math.max(
    periodInDays,
    getDaysDifference(startDate, endDate),
  );
  const previousPeriodStartDate = addDays(startDate, -daysDifference);

  return { previousPeriodStartDate, startDate, endDate, daysDifference };
};
