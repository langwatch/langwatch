import {
  type AnalyticsChartGroup,
  type AnalyticsChartMetric,
  analyticsChartGroupSchema,
  analyticsChartMetricSchema,
  analyticsChartSeriesSchema,
  analyticsChartTimeseriesSchema,
} from "@langwatch/analytics-contract";
import { formatMilliseconds } from "@langwatch/design-system/format-milliseconds";
import { z } from "zod";

import {
  type AggregationTypes,
  type AnalyticsGroup,
  type AnalyticsMetric,
  allAggregationTypes,
  numericAggregationTypes,
  type PipelineAggregationTypes,
  type PipelineFields,
  percentileAggregationTypes,
  sharedFiltersInputSchema,
} from "./analytics-vocabulary.ts";
import { formatMoney } from "./format-money.ts";

type GroupOf<Name extends string> = Name extends `${infer Group}.${string}` ? Group : never;
type KeyOf<Name extends string, Group extends string> = Name extends `${Group}.${infer Key}`
  ? Key
  : never;
/** One entry per contract name, grouped by its prefix: no name missing, none extra. */
type RegistryOf<Name extends string, Entry> = {
  [Group in GroupOf<Name>]: { [Key in KeyOf<Name, Group>]: Entry };
};

const numericMetricDefaults: Pick<AnalyticsMetric, "format" | "allowedAggregations"> = {
  format: "0.[0]a",
  allowedAggregations: [...numericAggregationTypes, ...percentileAggregationTypes],
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
      allowedAggregations: allAggregationTypes.filter((agg) => agg !== "cardinality"),
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
        (agg) => agg !== "cardinality" && agg !== "terms",
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
        (agg) => agg !== "cardinality" && agg !== "terms",
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
} satisfies RegistryOf<AnalyticsChartMetric, AnalyticsMetric>;

export type AnalyticsMetricsGroupsEnum = keyof typeof analyticsMetrics;

export type FlattenAnalyticsMetricsEnum = AnalyticsChartMetric;

export const flattenAnalyticsMetricsEnum = analyticsChartMetricSchema.options;

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
} satisfies RegistryOf<AnalyticsChartGroup, AnalyticsGroup>;

export type AnalyticsGroupsGroupsEnum = keyof typeof analyticsGroups;

export type FlattenAnalyticsGroupsEnum = AnalyticsChartGroup;

export const flattenAnalyticsGroupsEnum = analyticsChartGroupSchema.options;

const metricsByGroup: Readonly<Record<string, Readonly<Record<string, AnalyticsMetric>>>> =
  analyticsMetrics;
const groupsByName: Readonly<Record<string, Readonly<Record<string, AnalyticsGroup>>>> =
  analyticsGroups;

/** The metric a name reads, or none for a name the registry does not hold. */
export const getMetric = (
  groupMetric: FlattenAnalyticsMetricsEnum,
): AnalyticsMetric | undefined => {
  const [group = "", metric = ""] = groupMetric.split(".");
  return metricsByGroup[group]?.[metric];
};

/** The grouping a name reads; the registry holds every name the contract declares. */
export const getGroup = (groupMetric: FlattenAnalyticsGroupsEnum): AnalyticsGroup => {
  const [group = "", field = ""] = groupMetric.split(".");
  const found = groupsByName[group]?.[field];
  if (!found) throw new Error(`the analytics registry holds no group named ${groupMetric}`);
  return found;
};

export const seriesInput = analyticsChartSeriesSchema;

export type SeriesInputType = z.infer<typeof seriesInput>;

/**
 * Counts and sums are additive, so no matching rows IS zero; averages, extrema and percentiles
 * are not — they're only absent when there was no data, and defaulting to 0 fabricates a
 * measurement (e.g. a 0% pass rate on a day an evaluator never ran).
 */

/**
 * Both the ClickHouse summary builder and the timeseries row parser key their zero-defaulting
 * on this predicate.
 */
export function isZeroWhenAbsentSeries(series: SeriesInputType): boolean {
  if (series.pipeline) return series.pipeline.aggregation === "sum";
  return (
    series.aggregation === "cardinality" ||
    series.aggregation === "terms" ||
    series.aggregation === "sum"
  );
}

export const timeseriesSeriesInput = analyticsChartTimeseriesSchema;

export type TimeseriesSeriesInputType = z.infer<typeof timeseriesSeriesInput>;

export const timeseriesInput = z.object({
  ...sharedFiltersInputSchema.shape,
  ...timeseriesSeriesInput.shape,
});

export type TimeseriesInputType = z.infer<typeof timeseriesInput>;
