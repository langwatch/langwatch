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
  sharedFiltersInputSchema,
} from "./types";
import { formatMoney } from "../../utils/formatMoney";

const simpleFieldAnalytics = (
  field: string
): Omit<
  AnalyticsMetric,
  "label" | "colorSet" | "allowedAggregations" | "quickwitSupport"
> => ({
  format: "0.[0]",
  increaseIs: "good",
  aggregation: (aggregation: AggregationTypes) => ({
    [`${field.replaceAll(".", "_")}_${aggregation}`]: {
      [aggregation]: {
        field,
        ...(aggregation === "terms"
          ? { size: field === "trace_id" ? 0 : 999 }
          : {}),
      },
    },
  }),
  extractionPath: (aggregation: AggregationTypes) =>
    `${field.replaceAll(".", "_")}_${aggregation}`,
});

const numericFieldAnalyticsWithPercentiles = (
  field: string
): Omit<
  AnalyticsMetric,
  "label" | "colorSet" | "increaseIs" | "quickwitSupport"
> => ({
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

export const percentileToPercent: Record<PercentileAggregationTypes, number> = {
  median: 50,
  p99: 99,
  p95: 95,
  p90: 90,
};

export const analyticsMetrics = {
  metadata: {
    trace_id: {
      ...simpleFieldAnalytics("trace_id"),
      label: "Messages",
      colorSet: "orangeTones",
      allowedAggregations: ["cardinality"],
      quickwitSupport: true,
    },
    user_id: {
      ...simpleFieldAnalytics("metadata.user_id"),
      label: "Users",
      colorSet: "blueTones",
      allowedAggregations: ["cardinality"],
      quickwitSupport: true,
    },
    thread_id: {
      ...simpleFieldAnalytics("metadata.thread_id"),
      label: "Threads",
      colorSet: "greenTones",
      allowedAggregations: ["cardinality"],
      quickwitSupport: true,
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
      quickwitSupport: false,
    },
  },
  sentiment: {
    input_sentiment: {
      ...numericFieldAnalyticsWithPercentiles("input.satisfaction_score"),
      label: "Input Sentiment Score",
      colorSet: "yellowTones",
      format: "0.00%",
      increaseIs: "good",
      quickwitSupport: false,
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
      quickwitSupport: false,
    },
  },
  performance: {
    completion_time: {
      ...numericFieldAnalyticsWithPercentiles("metrics.total_time_ms"),
      label: "Completion Time",
      colorSet: "greenTones",
      format: formatMilliseconds,
      increaseIs: "bad",
      quickwitSupport: true,
    },
    first_token: {
      ...numericFieldAnalyticsWithPercentiles("metrics.first_token_ms"),
      label: "Time to First Token",
      colorSet: "cyanTones",
      format: formatMilliseconds,
      increaseIs: "bad",
      quickwitSupport: true,
    },
    total_cost: {
      ...numericFieldAnalyticsWithPercentiles("metrics.total_cost"),
      label: "Total Cost",
      colorSet: "greenTones",
      format: (amount) => formatMoney({ amount, currency: "USD" }),
      increaseIs: "neutral",
      quickwitSupport: true,
    },
    prompt_tokens: {
      ...numericFieldAnalyticsWithPercentiles("metrics.prompt_tokens"),
      label: "Prompt Tokens",
      colorSet: "blueTones",
      increaseIs: "neutral",
      quickwitSupport: true,
    },
    completion_tokens: {
      ...numericFieldAnalyticsWithPercentiles("metrics.completion_tokens"),
      label: "Completion Tokens",
      colorSet: "orangeTones",
      increaseIs: "neutral",
      quickwitSupport: true,
    },
    total_tokens: {
      ...numericFieldAnalyticsWithPercentiles("total_tokens"),
      label: "Total Tokens",
      colorSet: "purpleTones",
      increaseIs: "neutral",
      aggregation: (aggregation: AggregationTypes) => {
        const totalTokensScript = `
                    long promptTokens = 0;
                    long completionTokens = 0;

                    try {
                      promptTokens = doc['metrics.prompt_tokens'].size() > 0 ? doc['metrics.prompt_tokens'].value : 0;
                    } catch (Exception e) {
                      // ignore
                    }

                    try {
                      completionTokens = doc['metrics.completion_tokens'].size() > 0 ? doc['metrics.completion_tokens'].value : 0;
                    } catch (Exception e) {
                      // ignore
                    }

                    return promptTokens + completionTokens;
                  `;
        return {
          [`total_tokens_${aggregation}`]: percentileAggregationTypes.includes(
            aggregation as any
          )
            ? {
                percentiles: {
                  script: {
                    source: totalTokensScript,
                  },
                  percents: [
                    percentileToPercent[
                      aggregation as PercentileAggregationTypes
                    ],
                  ],
                },
              }
            : {
                [aggregation]: {
                  script: {
                    source: totalTokensScript,
                  },
                },
              },
        };
      },
      quickwitSupport: false,
    },
    tokens_per_second: {
      ...numericFieldAnalyticsWithPercentiles("tokens_per_second"),
      label: "Tokens per Second",
      colorSet: "cyanTones",
      increaseIs: "good",
      aggregation: (aggregation: AggregationTypes) => {
        const tokensPerSecondScript = `
          long completionTokens = 0;
          long duration = 0;

          try {
              duration = doc['spans.timestamps.finished_at'].value.getMillis() -
                 (doc['spans.timestamps.first_token_at'].size() > 0 ?
                     doc['spans.timestamps.first_token_at'].value.getMillis() :
                     doc['spans.timestamps.started_at'].value.getMillis());
          } catch (Exception e) {
              return 17;
          }

          try {
              completionTokens = doc['spans.metrics.completion_tokens'].size() > 0 ?
                  doc['spans.metrics.completion_tokens'].value : 0;
          } catch (Exception e) {
              return null;
          }

          if (duration == 0 || completionTokens == 0) {
              return null;
          }

          return completionTokens / (duration / 1000.0);
        `;
        return {
          [`tokens_per_second_${aggregation}`]: {
            nested: {
              path: "spans",
            },
            aggs: {
              child: percentileAggregationTypes.includes(aggregation as any)
                ? {
                    percentiles: {
                      script: {
                        source: tokensPerSecondScript,
                      },
                      percents: [
                        percentileToPercent[
                          aggregation as PercentileAggregationTypes
                        ],
                      ],
                    },
                  }
                : {
                    [aggregation]: {
                      script: {
                        source: tokensPerSecondScript,
                      },
                    },
                  },
            },
          },
        };
      },
      extractionPath: (aggregation: AggregationTypes) => {
        return percentileAggregationTypes.includes(aggregation as any)
          ? `tokens_per_second_${aggregation}>child>values>${
              percentileToPercent[aggregation as PercentileAggregationTypes]
            }.0`
          : `tokens_per_second_${aggregation}>child`;
      },
      quickwitSupport: false,
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
      quickwitSupport: false,
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
      quickwitSupport: false,
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
      quickwitSupport: false,
    },
  },
  evaluations: {
    evaluation_score: {
      label: "Evaluation Score",
      colorSet: "tealTones",
      format: "0.00a",
      increaseIs: "neutral",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality" && agg != "terms"
      ),
      requiresKey: {
        filter: "evaluations.evaluator_id",
      },
      aggregation: (aggregation, key) => {
        return {
          [`evaluation_score_${aggregation}_${key}`]: {
            nested: {
              path: "evaluations",
            },
            aggs: {
              child: {
                filter: {
                  bool: {
                    must: [{ term: { "evaluations.evaluator_id": key } }],
                  } as any,
                },
                aggs: {
                  child: {
                    [aggregation]: {
                      field: "evaluations.score",
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
      quickwitSupport: false,
    },
    evaluation_pass_rate: {
      label: "Evaluation Pass Rate",
      colorSet: "tealTones",
      format: "0.00a",
      increaseIs: "good",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality" && agg != "terms"
      ),
      requiresKey: {
        filter: "evaluations.evaluator_id",
      },
      aggregation: (aggregation, key) => {
        return {
          [`evaluation_pass_rate_${aggregation}_${key}`]: {
            nested: {
              path: "evaluations",
            },
            aggs: {
              child: {
                filter: {
                  bool: {
                    must: [{ term: { "evaluations.evaluator_id": key } }],
                  } as any,
                },
                aggs: {
                  child: {
                    [aggregation]: {
                      script: {
                        source: `
                          double result = 0.0;
                          try {
                            if (doc.containsKey('evaluations.passed') && doc['evaluations.passed'].size() > 0) {
                              result = doc['evaluations.passed'].value ? 1.0 : 0.0;
                            } else if (doc.containsKey('evaluations.score') && doc['evaluations.score'].size() > 0) {
                              result = doc['evaluations.score'].value;
                            }
                          } catch (Exception e) {
                            // Ignore exceptions and return default value
                          }
                          return result;
                        `,
                      },
                    },
                  },
                },
              },
            },
          },
        };
      },
      extractionPath: (aggregation: AggregationTypes, key) => {
        return `evaluation_pass_rate_${aggregation}_${key}>child>child`;
      },
      quickwitSupport: false,
    },
    evaluation_runs: {
      label: "Evaluation Runs",
      colorSet: "tealTones",
      format: "0.[00]a",
      increaseIs: "neutral",
      allowedAggregations: ["cardinality"],
      requiresKey: {
        filter: "evaluations.evaluator_id",
        optional: true,
      },
      aggregation: (aggregation, key) => ({
        [`checks_${aggregation}`]: {
          nested: {
            path: "evaluations",
          },
          aggs: {
            child: {
              filter: {
                bool: {
                  must: [
                    key
                      ? { term: { "evaluations.evaluator_id": key } }
                      : { match_all: {} },
                  ],
                } as any,
              },
              aggs: {
                child: {
                  [aggregation]: {
                    script: {
                      source: `return doc['evaluations.evaluation_id'].value`,
                    },
                  },
                },
              } as any,
            },
          },
        },
      }),
      extractionPath: (aggregation: AggregationTypes) => {
        return `checks_${aggregation}>child>child`;
      },
      quickwitSupport: false,
    },
  },
  threads: {
    average_duration_per_thread: {
      label: "Thread Duration",
      colorSet: "purpleTones",
      format: formatMilliseconds,
      increaseIs: "neutral",
      allowedAggregations: ["avg"],
      aggregation: () => ({
        thread_sessions: {
          terms: {
            field: "metadata.thread_id",
            size: 10000,
          },
          aggs: {
            session_duration: {
              scripted_metric: {
                init_script:
                  "state.min = Long.MAX_VALUE; state.max = Long.MIN_VALUE;",
                map_script: `
                  if (doc.containsKey('timestamps.started_at') && !doc['timestamps.started_at'].empty) {
                    long timestamp = doc['timestamps.started_at'].value.toInstant().toEpochMilli();
                    if (timestamp < state.min) state.min = timestamp;
                    if (timestamp > state.max) state.max = timestamp;
                  }
                `,
                combine_script: "return ['min': state.min, 'max': state.max];",
                reduce_script: `
                  long min = Long.MAX_VALUE;
                  long max = Long.MIN_VALUE;
                  for (state in states) {
                    if (state.min < min && state.min != Long.MAX_VALUE) min = state.min;
                    if (state.max > max && state.max != Long.MIN_VALUE) max = state.max;
                  }
                  if (min == Long.MAX_VALUE || max == Long.MIN_VALUE) return 0;
                  long duration = max - min;
                  return duration > 10800000 ? 10800000 : duration;
                `,
              },
            },
          },
        },
        average_duration_per_thread_avg: {
          avg_bucket: {
            buckets_path: "thread_sessions>session_duration.value",
          },
        },
      }),
      extractionPath: () => "average_duration_per_thread_avg",
      quickwitSupport: false,
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
    field: "trace_id",
  },
  user_id: {
    label: "per user",
    field: "metadata.user_id",
  },
  thread_id: {
    label: "per thread",
    field: "metadata.thread_id",
  },
  customer_id: {
    label: "per customer",
    field: "metadata.customer_id",
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
  terms: "count",
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
  quickwitSupport: true,
});

export const analyticsGroups = {
  topics: {
    topics: simpleFieldGroupping("Topic", "metadata.topic_id"),
  },
  metadata: {
    user_id: simpleFieldGroupping("User", "metadata.user_id"),

    thread_id: simpleFieldGroupping("Thread", "metadata.thread_id"),

    customer_id: simpleFieldGroupping("Customer ID", "metadata.customer_id"),

    labels: simpleFieldGroupping("Label", "metadata.labels"),

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
      quickwitSupport: false,
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
      quickwitSupport: false,
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
                      "doc['input.satisfaction_score'].size() == 0 ? false : doc['input.satisfaction_score'].value >= 0.1",
                    lang: "painless",
                  },
                },
              },
              negative: {
                script: {
                  script: {
                    source:
                      "doc['input.satisfaction_score'].size() == 0 ? false : doc['input.satisfaction_score'].value <= -0.1",
                    lang: "painless",
                  },
                },
              },
              neutral: {
                script: {
                  script: {
                    source:
                      "doc['input.satisfaction_score'].size() == 0 ? false : (doc['input.satisfaction_score'].value < 0.1 && doc['input.satisfaction_score'].value > -0.1)",
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
      quickwitSupport: false,
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
      quickwitSupport: false,
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
      quickwitSupport: false,
    },
  },
  evaluations: {
    evaluation_passed: {
      label: "Evaluation Passed",
      aggregation: (aggToGroup) => ({
        check_state_group: {
          nested: {
            path: "evaluations",
          },
          aggs: {
            child: {
              terms: {
                field: "evaluations.passed",
                size: 50,
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
      quickwitSupport: false,
    },
    evaluation_label: {
      label: "Evaluation Label",
      aggregation: (aggToGroup) => ({
        check_state_group: {
          nested: {
            path: "evaluations",
          },
          aggs: {
            child: {
              terms: {
                field: "evaluations.label",
                size: 50,
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
      quickwitSupport: false,
    },
    evaluation_processing_state: {
      label: "Evaluation Processing State",
      aggregation: (aggToGroup) => ({
        check_state_group: {
          nested: {
            path: "evaluations",
          },
          aggs: {
            child: {
              terms: {
                field: "evaluations.status",
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
      quickwitSupport: false,
    },
  },
  error: {
    has_error: {
      label: "Contains Error",
      aggregation: (aggToGroup) => ({
        error_group: {
          terms: {
            script: {
              source:
                "doc['error.has_error'].size() == 0 ? 'without error' : (doc['error.has_error'].value ? 'with error' : 'without error')",
              lang: "painless",
            },
            size: 50,
            missing: "without error",
          },
          aggs: aggToGroup,
        },
      }),
      extractionPath: () => "error_group>buckets",
      quickwitSupport: false,
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

export const timeseriesSeriesInput = z.object({
  query: z.optional(z.string()),
  series: z.array(seriesInput),
  groupBy: z.optional(z.enum(flattenAnalyticsGroupsEnum)),
  timeScale: z.optional(z.union([z.literal("full"), z.number().int()])),
});

export type TimeseriesSeriesInputType = z.infer<typeof timeseriesSeriesInput>;

export const timeseriesInput = sharedFiltersInputSchema.extend(
  timeseriesSeriesInput.shape
);

export type TimeseriesInputType = z.infer<typeof timeseriesInput>;
