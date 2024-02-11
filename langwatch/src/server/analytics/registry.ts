import { z } from "zod";
import {
  allAggregationTypes,
  type AggregationTypes,
  type AnalyticsMetric,
  type TracesPivotFilterQuery,
  type TracesPivotFilters,
  type PipelineFields,
  type PipelineAggregationTypes,
  type AnalyticsGroup,
  aggregationTypesEnum,
  pipelineAggregationTypesEnum,
  pipelineFieldsEnum,
} from "./types";

const simpleFieldAnalytics = (
  field: string
): Omit<AnalyticsMetric, "label" | "allowedAggregations"> => ({
  aggregation: (aggregation: AggregationTypes) => ({
    [`${field.replaceAll(".", "_")}_${aggregation}`]: {
      [aggregation]: { field },
    },
  }),
  extractionPath: (aggregation: AggregationTypes) =>
    `${field.replaceAll(".", "_")}_${aggregation}`,
});

export const analyticsMetrics = {
  volume: {
    trace_id: {
      label: "Messages",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.trace_id"),
    },
    user_id: {
      label: "Users",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.metadata.user_id"),
    },
    thread_id: {
      label: "Threads",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.metadata.thread_id"),
    },
  },
  sentiment: {
    input_sentiment: {
      label: "Input Sentiment Score",
      allowedAggregations: allAggregationTypes,
      ...simpleFieldAnalytics("trace.input.satisfaction_score"),
    },
    thumbs_up_down: {
      label: "Thumbs Up/Down Score",
      allowedAggregations: allAggregationTypes,
      aggregation: (aggregation) => ({
        [`thumbs_up_down_${aggregation}`]: {
          nested: {
            path: "events",
          },
          aggs: {
            child: {
              filter: {
                bool: {
                  must: [{ term: { "events.event_type": "thumbs_up_down" } }],
                } as any,
              },
              aggs:
                aggregation === "cardinality"
                  ? ({
                      cardinality: {
                        cardinality: { field: "events.event_id" },
                      },
                    } as any)
                  : {
                      child: {
                        nested: {
                          path: "events.metrics",
                        },
                        aggs: {
                          child: {
                            filter: {
                              bool: {
                                must: [
                                  { term: { "events.metrics.key": "vote" } },
                                ],
                                must_not: {
                                  term: { "events.metrics.value": 0 },
                                },
                              } as any,
                            },
                            aggs: {
                              child: {
                                [aggregation]: {
                                  field: "events.metrics.value",
                                },
                              },
                            },
                          },
                        },
                      },
                    },
            },
          },
        },
      }),
      extractionPath: (aggregation: AggregationTypes) => {
        return aggregation === "cardinality"
          ? `thumbs_up_down_${aggregation}>child>cardinality`
          : `thumbs_up_down_${aggregation}>child>child>child>child`;
      },
    },
  },
} satisfies Record<string, Record<string, AnalyticsMetric>>;

export type AnalyticsMetricsGroupsEnum = keyof typeof analyticsMetrics;

export type FlattenAnalyticsMetricsEnum = {
  [T in AnalyticsMetricsGroupsEnum]: `${T}.${string &
    keyof (typeof analyticsMetrics)[T]}`;
}[AnalyticsMetricsGroupsEnum];

export const flattenAnalyticsMetricsEnum = Object.keys(
  analyticsMetrics
).flatMap((key) =>
  Object.keys(analyticsMetrics[key as AnalyticsMetricsGroupsEnum]).map(
    (subkey) => [key, subkey].join(".")
  )
) as [FlattenAnalyticsMetricsEnum, ...FlattenAnalyticsMetricsEnum[]];

export const tracesPivotFilterQueries: {
  [T in keyof TracesPivotFilters]: {
    [K in keyof TracesPivotFilters[T]]: TracesPivotFilterQuery;
  };
} = {
  topics: {
    topics: {
      name: "Topics",
      field: "trace.metadata.topics",
    },
  },
  metadata: {
    user_id: {
      name: "Users",
      field: "trace.metadata.user_id",
    },
    thread_id: {
      name: "Threads",
      field: "trace.metadata.thread_id",
    },
    customer_id: {
      name: "Customer ID",
      field: "trace.metadata.customer_id",
    },
    labels: {
      name: "Labels",
      field: "trace.metadata.labels",
    },
  },
};

export const analyticsPipelines: {
  [K in PipelineFields]: { label: string; field: string };
} = {
  trace_id: {
    label: "per message",
    field: "trace.trace_id",
  },
  user_id: {
    label: "per user",
    field: "trace.metadata.user_id",
  },
  thread_id: {
    label: "per thread",
    field: "trace.metadata.thread_id",
  },
  customer_id: {
    label: "per customer",
    field: "trace.metadata.customer_id",
  },
};

export const pipelineAggregationsToElasticSearch: {
  [K in PipelineAggregationTypes]: string;
} = {
  sum: "sum_bucket",
  avg: "avg_bucket",
  min: "min_bucket",
  max: "max_bucket",
  cumulative_sum: "cumulative_sum",
};

export const pipelineAggregations: Record<PipelineAggregationTypes, string> = {
  avg: "average",
  sum: "sum",
  min: "minimum",
  max: "maximum",
  cumulative_sum: "cumulative sum",
};

export const metricAggregations: Record<AggregationTypes, string> = {
  cardinality: "count",
  avg: "average",
  sum: "sum",
  min: "minimum",
  max: "maximum",
};

const simpleFieldGroupping = (name: string, field: string): AnalyticsGroup => ({
  label: name,
  aggregation: () => ({
    terms: {
      field: field,
      size: 100,
      missing: "unknown",
    },
  }),
});

export const analyticsGroups = {
  topics: {
    topics: simpleFieldGroupping("Topic", "trace.metadata.topics"),
  },
  metadata: {
    user_id: simpleFieldGroupping("User", "trace.metadata.user_id"),

    thread_id: simpleFieldGroupping("Thread", "trace.metadata.thread_id"),

    customer_id: simpleFieldGroupping(
      "Customer ID",
      "trace.metadata.customer_id"
    ),

    labels: simpleFieldGroupping("Label", "trace.metadata.labels"),
  },
} satisfies Record<string, Record<string, AnalyticsGroup>>;

export type AnalyticsGroupsGroupsEnum = keyof typeof analyticsGroups;

export type FlattenAnalyticsGroupsEnum = {
  [T in AnalyticsGroupsGroupsEnum]: `${T}.${string &
    keyof (typeof analyticsGroups)[T]}`;
}[AnalyticsGroupsGroupsEnum];

export const flattenAnalyticsGroupsEnum = Object.keys(analyticsGroups).flatMap(
  (key) =>
    Object.keys(analyticsGroups[key as AnalyticsGroupsGroupsEnum]).map(
      (subkey) => [key, subkey].join(".")
    )
) as [FlattenAnalyticsGroupsEnum, ...FlattenAnalyticsGroupsEnum[]];

export const getMetric = (
  groupMetric: FlattenAnalyticsMetricsEnum
): AnalyticsMetric => {
  const [group, metric_] = groupMetric.split(".") as [
    AnalyticsMetricsGroupsEnum,
    string,
  ];
  return (analyticsMetrics[group] as any)[metric_];
};

export const getGroup = (
  groupMetric: FlattenAnalyticsGroupsEnum
): AnalyticsGroup => {
  const [group, field] = groupMetric.split(".") as [
    AnalyticsGroupsGroupsEnum,
    string,
  ];
  return (analyticsGroups[group] as any)[field];
};

export const seriesInput = z.object({
  metric: z.enum(flattenAnalyticsMetricsEnum),
  aggregation: aggregationTypesEnum,
  pipeline: z.optional(
    z.object({
      field: pipelineFieldsEnum,
      aggregation: pipelineAggregationTypesEnum,
    })
  ),
});

export type SeriesInputType = z.infer<typeof seriesInput>;

export const timeseriesInput = z.object({
  series: z.array(seriesInput),
  groupBy: z.optional(z.enum(flattenAnalyticsGroupsEnum)),
})