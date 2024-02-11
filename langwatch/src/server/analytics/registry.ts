import {
  allAggregationTypes,
  type AggregationTypes,
  type AnalyticsMetric,
  type TracesPivotFilterQuery,
  type TracesPivotFilters,
  type PipelineFields,
  type PipelineAggregationTypes,
  type AnalyticsGroup,
} from "./types";

const simpleFieldAnalytics = (
  field: string
): Omit<AnalyticsMetric, "name" | "allowedAggregations"> => ({
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
      name: "Messages",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.trace_id"),
    },
    user_id: {
      name: "Users",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.metadata.user_id"),
    },
    thread_id: {
      name: "Threads",
      allowedAggregations: ["cardinality"],
      ...simpleFieldAnalytics("trace.metadata.thread_id"),
    },
  },
  sentiment: {
    input_sentiment: {
      name: "Input Sentiment",
      allowedAggregations: allAggregationTypes,
      ...simpleFieldAnalytics("trace.input.satisfaction_score"),
    },
    thumbs_up_down: {
      name: "Thumbs Up/Down",
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

export const pipelineFields: { [K in PipelineFields]: string } = {
  trace_id: "trace.trace_id",
  user_id: "trace.metadata.user_id",
  thread_id: "trace.metadata.thread_id",
  customer_id: "trace.metadata.customer_id",
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

const simpleFieldGroupping = (name: string, field: string): AnalyticsGroup => ({
  name,
  aggregation: () => ({
    terms: {
      field: field,
      size: 100,
      missing: `unknown ${name}`,
    },
  }),
});

export const analyticsGroups = {
  topics: {
    topics: simpleFieldGroupping("Topics", "trace.metadata.topics"),
  },
  metadata: {
    user_id: simpleFieldGroupping("Users", "trace.metadata.user_id"),

    thread_id: simpleFieldGroupping("Threads", "trace.metadata.thread_id"),

    customer_id: simpleFieldGroupping(
      "Customer ID",
      "trace.metadata.customer_id"
    ),

    labels: simpleFieldGroupping("Labels", "trace.metadata.labels"),
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
