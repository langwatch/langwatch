import { addDays, differenceInCalendarDays } from "date-fns";
import { z } from "zod";
import {
  EVENTS_INDEX,
  SPAN_INDEX,
  TRACE_INDEX,
  esClient,
} from "../../../elasticsearch";
import type {
  AggregationsAggregationContainer,
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import type { Trace } from "../../../tracer/types";
import { type sharedFiltersInputSchema } from "../../../analytics/types";

export const sharedAnalyticsFilterInput = z.object({
  projectId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  user_id: z.string().optional(),
  thread_id: z.string().optional(),
  customer_ids: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
});

export const sharedAnalyticsFilterInputWithAggregations =
  sharedAnalyticsFilterInput.extend({
    aggregations: z.array(z.enum(["customer_id", "labels", "model", "topics"])),
  });

export const generateTraceQueryConditions = ({
  projectId,
  startDate,
  endDate,
  user_id,
  thread_id,
  customer_ids,
  labels,
  topics,
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
        "timestamps.started_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    ...(user_id ? [{ term: { "metadata.user_id": user_id } }] : []),
    ...(thread_id ? [{ term: { "metadata.thread_id": thread_id } }] : []),
    ...(customer_ids
      ? [{ terms: { "metadata.customer_id": customer_ids } }]
      : []),
    ...(labels ? [{ terms: { "metadata.labels": labels } }] : []),
    ...(topics ? [{ terms: { "metadata.topic_id": topics } }] : []),
  ];
};

export const generateTraceChecksQueryConditions = ({
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
    ...(user_id ? [{ term: { "trace_metadata.user_id": user_id } }] : []),
    ...(thread_id ? [{ term: { "trace_metadata.thread_id": thread_id } }] : []),
    ...(customer_ids
      ? [{ terms: { "trace_metadata.customer_id": customer_ids } }]
      : []),
    ...(labels ? [{ terms: { "trace_metadata.labels": labels } }] : []),
    // ...(topics ? [{ terms: { topics: topics } }] : []),
  ];
};

export const generateEventsQueryConditions = ({
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
        "timestamps.started_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    ...(user_id ? [{ term: { "trace_metadata.user_id": user_id } }] : []),
    ...(thread_id ? [{ term: { "trace_metadata.thread_id": thread_id } }] : []),
    ...(customer_ids
      ? [{ terms: { "trace_metadata.customer_id": customer_ids } }]
      : []),
    ...(labels ? [{ terms: { "trace_metadata.labels": labels } }] : []),
    // ...(topics ? [{ terms: { topics: topics } }] : []),
  ];
};

export const spanQueryConditions = ({
  traceIds,
  projectId,
  startDate,
  endDate,
}: z.infer<typeof sharedAnalyticsFilterInput> & { traceIds: string[] }) => {
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
        "timestamps.started_at": {
          gte: startDate,
          lte: endDate_,
          format: "epoch_millis",
        },
      },
    },
    {
      terms: { trace_id: traceIds },
    },
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
  const { previousPeriodStartDate } = currentVsPreviousDates(input);

  return currentVsPreviousElasticSearchAggregation<T>({
    input,
    aggs,
    index: TRACE_INDEX,
    conditions: generateTraceQueryConditions({
      ...input,
      startDate: previousPeriodStartDate.getTime(),
    }),
  });
};

export const currentVsPreviousSpansAggregation = async <
  T extends Record<string, any>,
>({
  aggs,
  input,
  extraConditions,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInput>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
  extraConditions?: any[];
}) => {
  const { previousPeriodStartDate } = currentVsPreviousDates(input);

  const tracesResult = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      _source: ["trace_id"],
      size: 10000,
      query: {
        bool: {
          //@ts-ignore
          filter: generateTraceQueryConditions({
            ...input,
            startDate: previousPeriodStartDate.getTime(),
          }),
        },
      },
    },
  });

  const traceIds = tracesResult.hits.hits.map((hit) => hit._source!.trace_id);

  return currentVsPreviousElasticSearchAggregation<T>({
    input,
    aggs,
    index: SPAN_INDEX,
    conditions: [
      ...spanQueryConditions({
        ...input,
        startDate: previousPeriodStartDate.getTime(),
        traceIds,
      }),
      ...(extraConditions ?? []),
    ],
  });
};

export const currentVsPreviousEventsAggregation = async <
  T extends Record<string, any>,
>({
  aggs,
  input,
  extraConditions,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInput>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
  extraConditions?: any[];
}) => {
  const { previousPeriodStartDate } = currentVsPreviousDates(input);

  return currentVsPreviousElasticSearchAggregation<T>({
    input,
    aggs,
    index: EVENTS_INDEX,
    conditions: [
      ...generateEventsQueryConditions({
        ...input,
        startDate: previousPeriodStartDate.getTime(),
      }),
      ...(extraConditions ?? []),
    ],
  });
};

export const currentVsPreviousDates = (
  input: z.infer<typeof sharedAnalyticsFilterInput>
) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const daysDifference = getDaysDifference(startDate, endDate);
  const previousPeriodStartDate = addDays(
    new Date(input.startDate),
    -daysDifference
  );

  return { previousPeriodStartDate, endDate, daysDifference };
};

const currentVsPreviousElasticSearchAggregation = async <
  T extends Record<string, any>,
>({
  aggs,
  input,
  index,
  conditions,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInput>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
  index: typeof TRACE_INDEX | typeof SPAN_INDEX | typeof EVENTS_INDEX;
  conditions: any[];
}) => {
  const { previousPeriodStartDate, endDate, daysDifference } =
    currentVsPreviousDates(input);

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
    index,
    body: {
      aggs: {
        ...aggregateQuery,
      },
      query: {
        //@ts-ignore
        bool: {
          filter: conditions,
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
      aggregation[key as keyof T] =
        value[key].value !== undefined
          ? value[key].value
          : value[key].buckets?.[0]?.doc_count !== undefined
          ? value[key].buckets[0].doc_count
          : typeof value[key] === "object"
          ? value[key]
          : undefined;
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
  return groupedElasticSearchAggregation<T>({
    input,
    aggs,
    index: TRACE_INDEX,
    conditions: generateTraceQueryConditions(input),
  });
};

export const groupedSpansAggregation = async <T extends Record<string, any>>({
  aggs,
  input,
  extraConditions,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInputWithAggregations>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
  extraConditions?: any[];
}) => {
  const { previousPeriodStartDate } = currentVsPreviousDates(input);

  const tracesResult = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      _source: ["trace_id"],
      size: 10000,
      query: {
        bool: {
          //@ts-ignore
          filter: generateTraceQueryConditions({
            ...input,
            startDate: previousPeriodStartDate.getTime(),
          }),
        },
      },
    },
  });

  const traceIds = tracesResult.hits.hits.map((hit) => hit._source!.trace_id);

  return groupedElasticSearchAggregation<T>({
    input,
    aggs,
    index: SPAN_INDEX,
    conditions: [
      ...spanQueryConditions({
        ...input,
        startDate: previousPeriodStartDate.getTime(),
        traceIds,
      }),
      ...(extraConditions ?? []),
    ],
  });
};

const groupedElasticSearchAggregation = async <T extends Record<string, any>>({
  aggs,
  input,
  index,
  conditions,
}: {
  input: z.infer<typeof sharedAnalyticsFilterInputWithAggregations>;
  aggs: Record<keyof T, AggregationsAggregationContainer>;
  index: typeof TRACE_INDEX | typeof SPAN_INDEX;
  conditions: any[];
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
        terms: {
          field: `metadata.${field}`,
          size: 100,
          missing: `unknown ${field}`,
        },
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
    index,
    body: {
      aggs: {
        ...aggregationQueries,
      },
      query: {
        //@ts-ignore
        bool: {
          filter: conditions,
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
export const generateTracesPivotQueryConditions = ({
  projectId,
  startDate,
  endDate,
  filters,
}: z.infer<typeof sharedFiltersInputSchema>): {
  pivotIndexConditions: QueryDslQueryContainer;
  isAnyFilterPresent: boolean;
} => {
  // If end date is very close to now, force it to be now, to allow frontend to keep refetching for new messages
  const endDate_ =
    new Date().getTime() - endDate < 1000 * 60 * 60
      ? new Date().getTime()
      : endDate;

  const { metadata, topics: topicsGroup } = filters;
  const { topics, subtopics } = topicsGroup ?? {};
  const { user_id, thread_id, customer_id, labels } = metadata ?? {};

  const filterConditions: QueryDslQueryContainer[] = [
    ...(user_id ? [{ terms: { "trace.metadata.user_id": user_id } }] : []),
    ...(thread_id
      ? [{ terms: { "trace.metadata.thread_id": thread_id } }]
      : []),
    ...(customer_id
      ? [{ terms: { "trace.metadata.customer_id": customer_id } }]
      : []),
    ...(labels ? [{ terms: { "trace.metadata.labels": labels } }] : []),
    ...(topics ? [{ terms: { "trace.metadata.topic_id": topics } }] : []),
    ...(subtopics ? [{ terms: { "trace.metadata.subtopic_id": subtopics } }] : []),
  ];

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
  };
};
