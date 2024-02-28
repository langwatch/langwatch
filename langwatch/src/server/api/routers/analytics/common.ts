import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { addDays, differenceInCalendarDays } from "date-fns";
import { type z } from "zod";
import { type sharedFiltersInputSchema } from "../../../analytics/types";
import { availableFilters } from "../../../filters/registry";
import type { FilterField } from "../../../filters/types";

const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

export const currentVsPreviousDates = (
  input: z.infer<typeof sharedFiltersInputSchema>,
  period?: number | string
) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const daysDifference = Math.max(
    typeof period === "number" ? period : 1,
    getDaysDifference(startDate, endDate)
  );
  const previousPeriodStartDate = addDays(startDate, -daysDifference);

  return { previousPeriodStartDate, startDate, endDate, daysDifference };
};

export const generateTracesPivotQueryConditions = ({
  projectId,
  startDate,
  endDate,
  filters,
}: z.infer<typeof sharedFiltersInputSchema>): {
  pivotIndexConditions: QueryDslQueryContainer;
  isAnyFilterPresent: boolean;
  endDateUsedForQuery: number;
} => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60
      ? new Date().getTime()
      : endDate;

  const filterConditions: QueryDslQueryContainer[] = [];
  for (const [key, values] of Object.entries(filters)) {
    if (values.length > 0) {
      const filter = availableFilters[key as FilterField];
      filterConditions.push(filter.query(values));
    }
  }

  return {
    pivotIndexConditions: {
      bool: {
        must: [
          {
            term: { "trace.project_id": projectId },
          },
          {
            range: {
              "trace.timestamps.started_at": {
                gte: startDate,
                lte: endDate_,
                format: "epoch_millis",
              },
            },
          },
          ...filterConditions,
        ],
      } as QueryDslBoolQuery,
    },
    isAnyFilterPresent: filterConditions.length > 0,
    endDateUsedForQuery: endDate_,
  };
};
