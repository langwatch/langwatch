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
  query,
}: z.infer<typeof sharedFiltersInputSchema>): {
  pivotIndexConditions: QueryDslQueryContainer;
  isAnyFilterPresent: boolean;
  endDateUsedForQuery: number;
} => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60 * 2
      ? new Date().getTime()
      : endDate;

  let filterConditions: QueryDslQueryContainer[] = [];

  for (const [field, params] of Object.entries(filters)) {
    if (params.length == 0) {
      continue;
    }

    const col = collectConditions(field as FilterField, params);
    filterConditions = filterConditions.concat(col);
  }

  return {
    pivotIndexConditions: {
      bool: {
        must: [
          {
            term: { project_id: projectId },
          },
          ...(query ? [{ query_string: { query } }] : []),
          {
            range: {
              "timestamps.started_at": {
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

const collectConditions = (
  field: FilterField,
  params:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>,
  keys: string[] = []
): QueryDslQueryContainer[] => {
  const key = keys[0];
  const subkey = keys[1];

  if (Array.isArray(params)) {
    const conditions: QueryDslQueryContainer[] = [];
    const filter = availableFilters[field];

    const andConditions: QueryDslQueryContainer[] = [];
    if (filter.requiresKey && key) {
      andConditions.push(
        availableFilters[filter.requiresKey.filter].query(
          [key],
          undefined,
          undefined
        )
      );
    }

    if (filter.requiresSubkey && subkey) {
      andConditions.push(
        availableFilters[filter.requiresSubkey.filter].query(
          [subkey],
          key,
          undefined
        )
      );
    }

    if (
      (!filter.requiresKey || key) &&
      (!filter.requiresSubkey || subkey) &&
      params.length > 0
    ) {
      andConditions.push(filter.query(params, key, subkey));
    }

    if (andConditions.length > 1) {
      conditions.push({
        bool: {
          must: andConditions,
        } as QueryDslBoolQuery,
      });
    } else if (andConditions.length === 1) {
      conditions.push(andConditions[0]!);
    }

    return conditions;
  } else if (typeof params === "object") {
    const conditions: QueryDslQueryContainer[] = [
      {
        bool: {
          should: Object.entries(params).flatMap(([key, values]) => {
            return collectConditions(field, values, [...keys, key]);
          }),
        } as QueryDslBoolQuery,
      },
    ];

    return conditions;
  }

  return [];
};
