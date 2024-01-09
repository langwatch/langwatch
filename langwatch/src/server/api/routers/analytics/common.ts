import { addDays, differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import { TRACE_INDEX } from "../traces";
import { esClient } from "../../../elasticsearch";
import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/types";

export const sharedAnalyticsFilterInput = z.object({
  projectId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  user_id: z.string().optional(),
  thread_id: z.string().optional(),
  customer_ids: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

export const sharedAnalyticsFilterInputWithAggregations =
  sharedAnalyticsFilterInput.extend({
    aggregations: z.array(z.enum(["customer_id", "labels"])),
  });

export const generateQueryConditions = ({
  projectId,
  startDate,
  endDate,
  user_id,
  thread_id,
  customer_ids,
  labels,
}: z.infer<typeof sharedAnalyticsFilterInput>) => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60
      ? new Date().getTime()
      : endDate;

  return [
    {
      term: { project_id: projectId },
    },
    {
      range: {
        "timestamps.inserted_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    ...(user_id ? [{ term: { user_id: user_id } }] : []),
    ...(thread_id ? [{ term: { thread_id: thread_id } }] : []),
    ...(customer_ids ? [{ terms: { customer_id: customer_ids } }] : []),
    ...(labels ? [{ terms: { labels: labels } }] : []),
  ];
};

export const dateTicks = (startDate: Date, endDate: Date, field: string) => {
  return {
    field: field,
    calendar_interval: "day",
    min_doc_count: 0,
    extended_bounds: {
      min: startDate.getTime(),
      max: endDate.getTime(),
    },
  };
};

export const getDaysDifference = (startDate: Date, endDate: Date) =>
  differenceInCalendarDays(endDate, startDate) + 1;

export const currentVsPreviousTracesAggregation = async <
  T extends Record<string, any>,
>({
  aggs,
  input,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInput>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
}) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const daysDifference = getDaysDifference(startDate, endDate);
  const previousPeriodStartDate = addDays(
    new Date(input.startDate),
    -daysDifference
  );

  const aggregateQuery = {
    traces_per_day: {
      date_histogram: dateTicks(
        previousPeriodStartDate,
        endDate,
        "timestamps.started_at"
      ) as any,
      aggs,
    },
  };

  const result = await esClient.search({
    index: TRACE_INDEX,
    body: {
      aggs: {
        ...aggregateQuery,
      },
      query: {
        bool: {
          //@ts-ignore
          filter: generateQueryConditions({
            ...input,
            startDate: previousPeriodStartDate.getTime(),
          }),
        },
      },
      size: 0,
    },
  });

  const aggregations: (T & { date: string })[] = (
    result.aggregations?.traces_per_day as any
  )?.buckets.map((value: any) => {
    const aggregation = {
      date: value.key_as_string,
    } as T & { date: string };
    for (const key of Object.keys(aggs)) {
      aggregation[key as keyof T] = value[key].value;
    }
    return aggregation;
  });

  const previousPeriod = aggregations.slice(0, daysDifference);
  const currentPeriod = aggregations.slice(daysDifference);

  return {
    previousPeriod,
    currentPeriod,
  };
};

export const groupedTracesAggregation = async <T extends Record<string, any>>({
  aggs,
  input,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInputWithAggregations>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
}) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);

  const aggregateQuery = {
    traces_per_day: {
      date_histogram: dateTicks(
        startDate,
        endDate,
        "timestamps.started_at"
      ) as any,
      aggs,
    },
  };

  const aggregationQueries = input.aggregations.reduce(
    (acc, field) => {
      acc[field] = {
        terms: { field, size: 100 },
        aggs: aggregateQuery,
      };
      return acc;
    },
    {} as Record<
      string,
      { terms: any; aggs: Record<string, AggregationsAggregationContainer> }
    >
  );

  const result = await esClient.search({
    index: TRACE_INDEX,
    body: {
      aggs: {
        ...aggregationQueries,
      },
      query: {
        bool: {
          //@ts-ignore
          filter: generateQueryConditions(input),
        },
      },
      size: 0,
    },
  });

  const aggregations = Object.entries(result.aggregations ?? {}).reduce(
    (acc, [_key, aggregation]) => {
      const buckets = (aggregation as any)?.buckets ?? [];
      for (const bucket of buckets) {
        acc[bucket.key] = bucket?.traces_per_day?.buckets.map((value: any) => {
          const aggregation = {
            date: value.key_as_string,
          } as T & { date: string };
          for (const key of Object.keys(aggs)) {
            aggregation[key as keyof T] = value[key].value;
          }
          return aggregation;
        });
      }

      return acc;
    },
    {} as Record<string, (T & { date: string })[]>
  );

  return aggregations;
};
