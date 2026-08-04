import { z } from "zod";

import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { formatMoney } from "../../utils/formatMoney";
import { filterFieldsEnum } from "../filters/types";
import {
  type AggregationTypes,
  type AnalyticsGroup,
  type AnalyticsMetric,
  aggregationTypesEnum,
  allAggregationTypes,
  numericAggregationTypes,
  type PipelineAggregationTypes,
  type PipelineFields,
  percentileAggregationTypes,
  pipelineAggregationTypesEnum,
  pipelineFieldsEnum,
  sharedFiltersInputSchema,
} from "./types";

const numericMetricDefaults: Pick<
  AnalyticsMetric,
  "format" | "allowedAggregations"
> = {
  format: "0.[0]a",
  allowedAggregations: [
    ...numericAggregationTypes,
    ...percentileAggregationTypes,
  ],
};

export const analyticsMetrics = {
  metadata: {
    trace_id: {
      label: "Traces",
      colorSet: "orangeTones",
      format: "0.[0]",
      increaseIs: "good",
      allowedAggregations: ["cardinality"],
    },
    user_id: {
      label: "Users",
      colorSet: "blueTones",
      format: "0.[0]",
      increaseIs: "good",
      allowedAggregations: ["cardinality"],
    },
    thread_id: {
      label: "Threads",
      colorSet: "greenTones",
      format: "0.[0]",
      increaseIs: "good",
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
    },
  },
  sentiment: {
    thumbs_up_down: {
      label: "Thumbs Up/Down Score",
      colorSet: "purpleTones",
      format: "0.00a",
      increaseIs: "good",
      allowedAggregations: allAggregationTypes,
    },
  },
  performance: {
    completion_time: {
      ...numericMetricDefaults,
      label: "Completion Time",
      colorSet: "greenTones",
      format: formatMilliseconds,
      increaseIs: "bad",
    },
    first_token: {
      ...numericMetricDefaults,
      label: "Time to First Token",
      colorSet: "cyanTones",
      format: formatMilliseconds,
      increaseIs: "bad",
    },
    total_cost: {
      ...numericMetricDefaults,
      label: "Total Cost",
      colorSet: "greenTones",
      format: (amount) => formatMoney({ amount, currency: "USD" }),
      increaseIs: "neutral",
    },
    cost_billed: {
      ...numericMetricDefaults,
      label: "Billed Cost",
      colorSet: "greenTones",
      format: (amount) => formatMoney({ amount, currency: "USD" }),
      increaseIs: "neutral",
    },
    cost_non_billed: {
      ...numericMetricDefaults,
      label: "Non-billed (theoretical) Cost",
      colorSet: "grayTones",
      format: (amount) => formatMoney({ amount, currency: "USD" }),
      increaseIs: "neutral",
    },
    prompt_tokens: {
      ...numericMetricDefaults,
      label: "Prompt Tokens",
      colorSet: "blueTones",
      increaseIs: "neutral",
    },
    completion_tokens: {
      ...numericMetricDefaults,
      label: "Completion Tokens",
      colorSet: "orangeTones",
      increaseIs: "neutral",
    },
    cache_read_tokens: {
      ...numericMetricDefaults,
      label: "Cache Read Tokens",
      colorSet: "tealTones",
      increaseIs: "neutral",
    },
    cache_write_tokens: {
      ...numericMetricDefaults,
      label: "Cache Write Tokens",
      colorSet: "yellowTones",
      increaseIs: "neutral",
    },
    reasoning_tokens: {
      ...numericMetricDefaults,
      label: "Reasoning Tokens",
      colorSet: "pinkTones",
      increaseIs: "neutral",
    },
    total_processed_tokens: {
      ...numericMetricDefaults,
      label: "Total Processed Tokens",
      colorSet: "purpleTones",
      increaseIs: "neutral",
    },
    total_tokens: {
      ...numericMetricDefaults,
      label: "Total Tokens",
      colorSet: "purpleTones",
      increaseIs: "neutral",
    },
    tokens_per_second: {
      ...numericMetricDefaults,
      label: "Tokens per Second",
      colorSet: "cyanTones",
      increaseIs: "good",
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
    },
    event_score: {
      label: "Event Score",
      colorSet: "purpleTones",
      format: "0.00a",
      increaseIs: "neutral",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality",
      ),
      requiresKey: {
        filter: "events.event_type",
      },
      requiresSubkey: {
        filter: "events.metrics.key",
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
    },
  },
  evaluations: {
    evaluation_score: {
      label: "Evaluation Score",
      colorSet: "tealTones",
      format: "0.00a",
      increaseIs: "neutral",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality" && agg != "terms",
      ),
      requiresKey: {
        filter: "evaluations.evaluator_id",
      },
    },
    evaluation_pass_rate: {
      label: "Evaluation Pass Rate",
      colorSet: "tealTones",
      format: "0%",
      increaseIs: "good",
      allowedAggregations: allAggregationTypes.filter(
        (agg) => agg != "cardinality" && agg != "terms",
      ),
      requiresKey: {
        filter: "evaluations.evaluator_id",
      },
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
    },
  },
  threads: {
    average_duration_per_thread: {
      label: "Thread Duration",
      colorSet: "purpleTones",
      format: formatMilliseconds,
      increaseIs: "neutral",
      allowedAggregations: ["avg"],
    },
  },
} satisfies Record<string, Record<string, AnalyticsMetric>>;

export type AnalyticsMetricsGroupsEnum = keyof typeof analyticsMetrics;

export type FlattenAnalyticsMetricsEnum = {
  [T in AnalyticsMetricsGroupsEnum]: `${T}.${string &
    keyof (typeof analyticsMetrics)[T]}`;
}[AnalyticsMetricsGroupsEnum];

export const flattenAnalyticsMetricsEnum = Object.keys(
  analyticsMetrics,
).flatMap((key) =>
  Object.keys(analyticsMetrics[key as AnalyticsMetricsGroupsEnum]).map(
    (subkey) => [key, subkey].join("."),
  ),
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

export const analyticsGroups = {
  topics: {
    topics: { label: "Topic" },
  },
  traces: {
    trace_name: { label: "Trace Name" },
  },
  metadata: {
    user_id: { label: "User" },
    thread_id: { label: "Thread" },
    customer_id: { label: "Customer ID" },
    labels: { label: "Label" },
    model: { label: "Model" },
    span_type: { label: "Span Type" },
  },
  sentiment: {
    thumbs_up_down: { label: "Thumbs Up/Down" },
  },
  events: {
    event_type: { label: "Event Type" },
  },
  evaluations: {
    evaluation_passed: {
      label: "Evaluation Passed",
      requiresKey: {
        filter: "evaluations.evaluator_id",
        optional: true,
      },
    },
    evaluation_label: {
      label: "Evaluation Label",
      requiresKey: {
        filter: "evaluations.evaluator_id",
        optional: true,
      },
    },
    evaluation_processing_state: {
      label: "Evaluation Processing State",
      requiresKey: {
        filter: "evaluations.evaluator_id",
        optional: true,
      },
    },
  },
  error: {
    has_error: { label: "Contains Error" },
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
      (subkey) => [key, subkey].join("."),
    ),
) as [FlattenAnalyticsGroupsEnum, ...FlattenAnalyticsGroupsEnum[]];

export const getMetric = (
  groupMetric: FlattenAnalyticsMetricsEnum,
): AnalyticsMetric => {
  const [group, metric_] = groupMetric.split(".") as [
    AnalyticsMetricsGroupsEnum,
    string,
  ];
  return (analyticsMetrics[group] as any)[metric_];
};

export const getGroup = (
  groupMetric: FlattenAnalyticsGroupsEnum,
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
    }),
  ),
  filters: z.optional(
    z.record(
      filterFieldsEnum,
      z.union([
        z.array(z.string()),
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.record(z.string(), z.array(z.string()))),
      ]),
    ),
  ),
  asPercent: z.optional(z.boolean()),
});

export type SeriesInputType = z.infer<typeof seriesInput>;

/**
 * Whether an absent result value for this series truly means zero. Counts and
 * sums are additive: no matching rows IS zero. Averages, extrema and
 * percentiles are not: they are only ever absent when there was no data, and
 * defaulting them to 0 fabricates a measurement (e.g. a 0% pass rate on a day
 * an evaluator never ran). Pipeline series re-aggregate per entity, so the
 * cross-entity pipeline aggregation decides additivity.
 *
 * Both the ClickHouse summary builder (its empty-result coalesce) and the
 * timeseries row parser (its cross-period key normalisation) key their
 * zero-defaulting on this predicate.
 */
export function isZeroWhenAbsentSeries(series: SeriesInputType): boolean {
  if (series.pipeline) return series.pipeline.aggregation === "sum";
  return (
    series.aggregation === "cardinality" ||
    series.aggregation === "terms" ||
    series.aggregation === "sum"
  );
}

export const timeseriesSeriesInput = z.object({
  query: z.optional(z.string()),
  series: z.array(seriesInput),
  groupBy: z.optional(z.enum(flattenAnalyticsGroupsEnum)),
  groupByKey: z.optional(z.string()),
  timeScale: z.optional(z.union([z.literal("full"), z.number().int()])),
  timeZone: z.string(),
});

export type TimeseriesSeriesInputType = z.infer<typeof timeseriesSeriesInput>;

export const timeseriesInput = sharedFiltersInputSchema.extend(
  timeseriesSeriesInput.shape,
);

export type TimeseriesInputType = z.infer<typeof timeseriesInput>;
