import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import {
  aggregationTypesEnum,
  allAggregationTypes,
  numericAggregationTypes,
  percentileAggregationTypes,
  pipelineAggregationTypesEnum,
  pipelineFieldsEnum,
  type AggregationTypes,
  type AnalyticsGroup,
  type AnalyticsMetric,
  type PercentileAggregationTypes,
  type PipelineAggregationTypes,
  type PipelineFields,
} from "./types";

const simpleFieldAnalytics = (
  field: string
): Omit<AnalyticsMetric, "label" | "colorSet" | "allowedAggregations"> => ({
  format: "0.[0]a",
  increaseIs: "good",
  aggregation: (aggregation: AggregationTypes) => ({
    [`${field.replaceAll(".", "_")}_${aggregation}`]: {
      [aggregation]: { field },
    },
  }),
  extractionPath: (aggregation: AggregationTypes) =>
    `${field.replaceAll(".", "_")}_${aggregation}`,
});

const numericFieldAnalyticsWithPercentiles = (
  field: string
): Omit<AnalyticsMetric, "label" | "colorSet" | "increaseIs"> => ({
  format: "0.[0]a",
  allowedAggregations: [
    ...numericAggregationTypes,
    ...percentileAggregationTypes,
  ],
  aggregation: (aggregation: AggregationTypes) => ({
    [`${field.replaceAll(".", "_")}_${aggregation}`]:
      percentileAggregationTypes.includes(aggregation as any)
        ? {
            percentiles: {
              field,
              percents: [
                percentileToPercent[aggregation as PercentileAggregationTypes],
              ],
            },
          }
        : {
            [aggregation]: { field },
          },
  }),
  extractionPath: (aggregation: AggregationTypes) =>
    percentileAggregationTypes.includes(aggregation as any)
      ? `${field.replaceAll(".", "_")}_${aggregation}>values>${
          percentileToPercent[aggregation as PercentileAggregationTypes]
        }.0`
      : `${field.replaceAll(".", "_")}_${aggregation}`,
});

const percentileToPercent: Record<PercentileAggregationTypes, number> = {
  median: 50,
  p99: 99,
  p95: 95,
  p90: 90,
};

export const analyticsMetrics = {
  metadata: {
    trace_id: {
      ...simpleFieldAnalytics("trace.trace_id"),
      label: "Messages",
      colorSet: "orangeTones",
      allowedAggregations: ["cardinality"],
    },
    user_id: {
      ...simpleFieldAnalytics("trace.metadata.user_id"),
      label: "Users",
      colorSet: "blueTones",
      allowedAggregations: ["cardinality"],
    },
    thread_id: {
      ...simpleFieldAnalytics("trace.metadata.thread_id"),
      label: "Threads",
      colorSet: "greenTones",
      allowedAggregations: ["cardinality"],
    },
    span_type: {
      label: "Span Type",
      colorSet: "purpleTones",
      allowedAggregations: ["cardinality"],
      format: "0.[00]a",
      increaseIs: "neutral",
      requiresKey: {
        filter: "spans.type",
        optional: true,
      },
      aggregation: (aggregation, key) => ({
        [`span_type_${aggregation}`]: {
          nested: {
            path: "spans",
          },
          aggs: {
            child: {
              filter: {
                bool: {
                  must: [
                    key ? { term: { "spans.type": key } } : { match_all: {} },
                  ],
                } as any,
              },
              aggs: {
                cardinality: {
                  cardinality: { field: "spans.span_id" },
                },
              } as any,
            },
          },
        },
      }),
      extractionPath: (aggregation) => {
        return `span_type_${aggregation}>child>cardinality`;
      },
    },
  },
  sentiment: {
    input_sentiment: {
      ...numericFieldAnalyticsWithPercentiles("trace.input.satisfaction_score"),
      label: "Input Sentiment Score",
      colorSet: "yellowTones",
      format: "0.00%",
      increaseIs: "good",
    },
    thumbs_up_down: {
      label: "Thumbs Up/Down Score",
      colorSet: "purpleTones",
      format: "0.00a",
      increaseIs: "good",
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
  performance: {
    completion_time: {
      ...numericFieldAnalyticsWithPercentiles("trace.metrics.total_time_ms"),
      label: "Completion Time",
      colorSet: "greenTones",
      format: formatMilliseconds,
      increaseIs: "bad",
    },
    first_token: {
      ...simpleFieldAnalytics("trace.metrics.first_token_ms"),
      label: "Time to First Token",
      colorSet: "cyanTones",
      format: formatMilliseconds,
      increaseIs: "bad",
      allowedAggregations: numericAggregationTypes,
    },
    total_cost: {
      ...numericFieldAnalyticsWithPercentiles("trace.metrics.total_cost"),
      label: "Total Cost",
      colorSet: "greenTones",
      format: "$0.00[0]",
      increaseIs: "neutral",
    },
    prompt_tokens: {
      ...numericFieldAnalyticsWithPercentiles("trace.metrics.prompt_tokens"),
      label: "Prompt Tokens",
      colorSet: "blueTones",
      increaseIs: "neutral",
    },
    completion_tokens: {
      ...numericFieldAnalyticsWithPercentiles(
        "trace.metrics.completion_tokens"
      ),
      label: "Completion Tokens",
      colorSet: "orangeTones",
      increaseIs: "neutral",
    },
  },
  events: {
    event_type: {
      label: "Event Type",
      colorSet: "purpleTones",
      allowedAggregations: ["cardinality"],
      format: "0.[00]a",
      increaseIs: "neutral",
      requiresKey: {
        filter: "events.event_type",
        optional: true,
      },
      aggregation: (aggregation, key) => ({
        [`event_type_${aggregation}`]: {
          nested: {
            path: "events",
          },
          aggs: {
            child: {
              filter: {
                bool: {
                  must: [
                    key
                      ? { term: { "events.event_type": key } }
                      : { match_all: {} },
                  ],
                } as any,
              },
              aggs: {
                cardinality: {
                  cardinality: { field: "events.event_id" },
                },
              } as any,
            },
          },
        },
      }),
      extractionPath: (aggregation: AggregationTypes) => {
        return `event_type_${aggregation}>child>cardinality`;
      },
    },
    event_score: {
      label: "Event Score",
      colorSet: "purpleTones",
      format: "0.00a",
      increaseIs: "neutral",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality"
      ),
      requiresKey: {
        filter: "events.event_type",
      },
      requiresSubkey: {
        filter: "events.metrics.key",
      },
      aggregation: (aggregation, key, subkey) => {
        if (!key || !subkey)
          throw new Error(
            `Key and subkey are required for event_score ${aggregation} metric`
          );

        return {
          [`event_score_${aggregation}_${key}_${subkey}`]: {
            nested: {
              path: "events",
            },
            aggs: {
              child: {
                filter: {
                  bool: {
                    must: [{ term: { "events.event_type": key } }],
                  } as any,
                },
                aggs: {
                  child: {
                    nested: {
                      path: "events.metrics",
                    },
                    aggs: {
                      child: {
                        filter: {
                          bool: {
                            must: [{ term: { "events.metrics.key": subkey } }],
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
        };
      },
      extractionPath: (aggregation: AggregationTypes, key, subkey) => {
        return `event_score_${aggregation}_${key}_${subkey}>child>child>child>child`;
      },
    },
    event_details: {
      label: "Event Details",
      colorSet: "purpleTones",
      format: "0.[00]a",
      increaseIs: "neutral",
      allowedAggregations: ["cardinality"],
      requiresKey: {
        filter: "events.event_type",
      },
      requiresSubkey: {
        filter: "events.event_details.key",
      },
      aggregation: (aggregation, key, subkey) => {
        if (!key || !subkey)
          throw new Error(
            `Key and subkey are required for event_details ${aggregation} metric`
          );

        return {
          [`event_score_${aggregation}_${key}_${subkey}`]: {
            nested: {
              path: "events",
            },
            aggs: {
              child: {
                filter: {
                  bool: {
                    must: [{ term: { "events.event_type": key } }],
                  } as any,
                },
                aggs: {
                  child: {
                    nested: {
                      path: "events.event_details",
                    },
                    aggs: {
                      child: {
                        filter: {
                          bool: {
                            must: [
                              { term: { "events.event_details.key": subkey } },
                            ],
                          } as any,
                        },
                        aggs: {
                          child: {
                            cardinality: {
                              field: "events.event_details.value",
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
        };
      },
      extractionPath: (aggregation: AggregationTypes, key, subkey) => {
        return `event_score_${aggregation}_${key}_${subkey}>child>child>child>child`;
      },
    },
  },
  evaluations: {
    checks: {
      label: "Checks",
      colorSet: "tealTones",
      format: "0.[00]a",
      increaseIs: "neutral",
      allowedAggregations: ["cardinality"],
      requiresKey: {
        filter: "trace_checks.check_id",
        optional: true,
      },
      runtimeMappings: {
        trace_id_and_check_id: {
          type: "keyword",
          script:
            "emit(doc['trace_checks.trace_id'].value + ' ' + doc['trace_checks.check_id'].value)",
        },
      },
      aggregation: (aggregation, key) => ({
        [`checks_${aggregation}`]: {
          nested: {
            path: "trace_checks",
          },
          aggs: {
            child: {
              filter: {
                bool: {
                  must: [
                    key
                      ? { term: { "trace_checks.check_id": key } }
                      : { match_all: {} },
                  ],
                } as any,
              },
              aggs: {
                cardinality: {
                  cardinality: { field: "trace_id_and_check_id" },
                },
              } as any,
            },
          },
        },
      }),
      extractionPath: (aggregation: AggregationTypes) => {
        return `checks_${aggregation}>child>cardinality`;
      },
    },
    evaluation_score: {
      label: "Evaluation Score",
      colorSet: "tealTones",
      format: "0.00a",
      increaseIs: "neutral",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality"
      ),
      requiresKey: {
        filter: "trace_checks.check_id",
      },
      aggregation: (aggregation, key) => {
        return {
          [`evaluation_score_${aggregation}_${key}`]: {
            nested: {
              path: "trace_checks",
            },
            aggs: {
              child: {
                filter: {
                  bool: {
                    must: [{ term: { "trace_checks.check_id": key } }],
                  } as any,
                },
                aggs: {
                  child: {
                    [aggregation]: {
                      field: "trace_checks.value",
                    },
                  },
                },
              },
            },
          },
        };
      },
      extractionPath: (aggregation: AggregationTypes, key) => {
        return `evaluation_score_${aggregation}_${key}>child>child`;
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
};

export const pipelineAggregations: Record<PipelineAggregationTypes, string> = {
  avg: "average",
  sum: "sum",
  min: "minimum",
  max: "maximum",
};

export const metricAggregations: Record<AggregationTypes, string> = {
  cardinality: "count",
  avg: "average",
  sum: "sum",
  min: "minimum",
  max: "maximum",
  median: "median",
  p99: "99th percentile",
  p95: "95th percentile",
  p90: "90th percentile",
};

const simpleFieldGroupping = (name: string, field: string): AnalyticsGroup => ({
  label: name,
  aggregation: (aggToGroup) => ({
    [`${field}_group`]: {
      terms: {
        field: field,
        size: 50,
        missing: "unknown",
      },
      aggs: aggToGroup,
    },
  }),
  extractionPath: () => `${field}_group>buckets`,
});

export const analyticsGroups = {
  topics: {
    topics: simpleFieldGroupping("Topic", "trace.metadata.topic_id"),
  },
  metadata: {
    user_id: simpleFieldGroupping("User", "trace.metadata.user_id"),

    thread_id: simpleFieldGroupping("Thread", "trace.metadata.thread_id"),

    customer_id: simpleFieldGroupping(
      "Customer ID",
      "trace.metadata.customer_id"
    ),

    labels: simpleFieldGroupping("Label", "trace.metadata.labels"),

    model: {
      label: "Model",
      aggregation: (aggToGroup) => ({
        model_group: {
          nested: {
            path: "spans",
          },
          aggs: {
            child: {
              filter: {
                term: { "spans.type": "llm" },
              },
              aggs: {
                child: {
                  terms: {
                    field: "spans.model",
                    size: 50,
                    missing: "unknown",
                  },
                  aggs: {
                    back_to_root: {
                      reverse_nested: {},
                      aggs: aggToGroup,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extractionPath: () => "model_group>child>child>buckets>back_to_root",
    },

    span_type: {
      label: "Span Type",
      aggregation: (aggToGroup) => ({
        model_group: {
          nested: {
            path: "spans",
          },
          aggs: {
            child: {
              terms: {
                field: "spans.type",
                size: 50,
                missing: "unknown",
              },
              aggs: {
                back_to_root: {
                  reverse_nested: {},
                  aggs: aggToGroup,
                },
              },
            },
          },
        },
      }),
      extractionPath: () => "model_group>child>buckets>back_to_root",
    },
  },
  sentiment: {
    input_sentiment: {
      label: "Input Sentiment",
      aggregation: (aggToGroup) => ({
        input_sentiment_group: {
          filters: {
            filters: {
              positive: {
                script: {
                  script: {
                    source:
                      "doc['trace.input.satisfaction_score'].size() == 0 ? false : doc['trace.input.satisfaction_score'].value >= 0.1",
                    lang: "painless",
                  },
                },
              },
              negative: {
                script: {
                  script: {
                    source:
                      "doc['trace.input.satisfaction_score'].size() == 0 ? false : doc['trace.input.satisfaction_score'].value <= -0.1",
                    lang: "painless",
                  },
                },
              },
              neutral: {
                script: {
                  script: {
                    source:
                      "doc['trace.input.satisfaction_score'].size() == 0 ? false : (doc['trace.input.satisfaction_score'].value < 0.1 && doc['trace.input.satisfaction_score'].value > -0.1)",
                    lang: "painless",
                  },
                },
              },
            },
          },
          aggs: aggToGroup,
        },
      }),
      extractionPath: () => "input_sentiment_group>buckets",
    },
    thumbs_up_down: {
      label: "Thumbs Up/Down",
      aggregation: (aggToGroup) => {
        const actualGrouping: AggregationsAggregationContainer = {
          filters: {
            filters: {
              positive: {
                script: {
                  script: {
                    source:
                      "doc['events.metrics.key'].size() > 0 && doc['events.metrics.value'].size() > 0 && doc['events.metrics.key'].value == 'vote' && doc['events.metrics.value'].value == 1",
                    lang: "painless",
                  },
                },
              },
              negative: {
                script: {
                  script: {
                    source:
                      "doc['events.metrics.key'].size() > 0 && doc['events.metrics.value'].size() > 0 && doc['events.metrics.key'].value == 'vote' && doc['events.metrics.value'].value == -1",
                    lang: "painless",
                  },
                },
              },
              neutral: {
                script: {
                  script: {
                    source:
                      "doc['events.metrics.key'].size() > 0 && doc['events.metrics.value'].size() > 0 && doc['events.metrics.key'].value == 'vote' && doc['events.metrics.value'].value == 0",
                    lang: "painless",
                  },
                },
              },
            },
          },
          aggs: {
            back_to_root: {
              reverse_nested: {},
              aggs: aggToGroup,
            },
          },
        };

        return {
          thumbs_up_down_group: {
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
                aggs: {
                  filter: {
                    nested: {
                      path: "events.metrics",
                    },
                    aggs: {
                      child: actualGrouping,
                    },
                  },
                },
              },
            },
          },
        };
      },
      extractionPath: () =>
        "thumbs_up_down_group>child>filter>child>buckets>back_to_root",
    },
  },
  events: {
    event_type: {
      label: "Event Type",
      aggregation: (aggToGroup) => ({
        check_state_group: {
          nested: {
            path: "events",
          },
          aggs: {
            child: {
              terms: {
                field: "events.event_type",
                size: 50,
                missing: "unknown",
              },
              aggs: {
                back_to_root: {
                  reverse_nested: {},
                  aggs: aggToGroup,
                },
              },
            },
          },
        },
      }),
      extractionPath: () => "check_state_group>child>buckets>back_to_root",
    },
  },
  evaluations: {
    check_state: {
      label: "Check State",
      aggregation: (aggToGroup) => ({
        check_state_group: {
          nested: {
            path: "trace_checks",
          },
          aggs: {
            child: {
              terms: {
                field: "trace_checks.status",
                size: 50,
                missing: "unknown",
              },
              aggs: {
                back_to_root: {
                  reverse_nested: {},
                  aggs: aggToGroup,
                },
              },
            },
          },
        },
      }),
      extractionPath: () => "check_state_group>child>buckets>back_to_root",
    },
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
  key: z.optional(z.string()),
  subkey: z.optional(z.string()),
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
  timeScale: z.optional(z.union([z.literal("full"), z.number().int()])),
});
