import { z } from "zod";
import type {
  AnalyticsFeedbacksResult,
  AnalyticsTimeseriesBucket,
  AnalyticsTimeseriesResult,
  AnalyticsTopDocumentsResult,
} from "@langwatch/analytics-contract";

import { filterFieldsEnum } from "@langwatch/analytics-contract";

/** `T[]` unwrapped to `T`; anything else unchanged. */
type Unpacked<T> = T extends (infer U)[] ? U : T;

/** Every optional member of `T`, recursively, made required. */
type DeepRequired<T> = Required<{
  [K in keyof T]: T[K] extends object | undefined ? DeepRequired<Required<T[K]>> : T[K];
}>;

export const aggregationTypesEnum = z.enum([
  "terms",
  "cardinality",
  "avg",
  "sum",
  "min",
  "max",
  "median",
  "p99",
  "p95",
  "p90",
]);

export const allAggregationTypes = aggregationTypesEnum.options;

export const numericAggregationTypes: AggregationTypes[] = ["avg", "sum", "min", "max"];

export const percentileAggregationTypes = ["median", "p99", "p95", "p90"] as (
  | "median"
  | "p99"
  | "p95"
  | "p90"
)[] satisfies AggregationTypes[];

export type PercentileAggregationTypes = Unpacked<typeof percentileAggregationTypes>;

export type AggregationTypes = z.infer<typeof aggregationTypesEnum>;

export const pipelineFieldsEnum = z.enum([
  "trace_id",
  "user_id",
  "thread_id",
  "customer_id",
]);

export type PipelineFields = z.infer<typeof pipelineFieldsEnum>;

export const pipelineAggregationTypesEnum = z.enum(["sum", "avg", "min", "max"]);

export type PipelineAggregationTypes = z.infer<typeof pipelineAggregationTypesEnum>;

export const sharedFiltersInputSchema = z.object({
  projectId: z.string(),
  startDate: z.number().positive(),
  endDate: z.number().positive(),
  query: z.string().optional(),
  filters: z
    .partialRecord(
      filterFieldsEnum,
      z.union([
        z.array(z.string()),
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.record(z.string(), z.array(z.string()))),
      ]),
    )
    .default({}),
  traceIds: z.array(z.string()).optional(),
  negateFilters: z.boolean().optional(),
});

export type SharedFiltersInput = z.infer<typeof sharedFiltersInputSchema>;

/**
 * One series a chart asks for: which metric, aggregated how, narrowed by what.
 *
 * `metric` and `groupBy` are strings rather than an enum of the registry's
 * keys. The registry that enumerated them was presentation-coupled — every
 * entry carried a colour set and a number formatter — and it stayed with the
 * browser surface that renders those. What decides whether a metric is real is
 * the metric translator, which refuses a key it has no expression for, so the
 * narrowing is where the meaning is rather than duplicated at the wire.
 */
export const seriesInputSchema = z.object({
  metric: z.string().min(1),
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
    z.partialRecord(
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

export type SeriesInput = z.infer<typeof seriesInputSchema>;

/**
 * The full timeseries request: the shared filters plus the series to compute.
 *
 * Extended from {@link sharedFiltersInputSchema} rather than declared beside
 * it, so a constraint added to the filter half reaches the charted reads, the
 * REST analytics body and the traces filter input together instead of one of
 * the three.
 */
export const timeseriesInputSchema = sharedFiltersInputSchema.extend({
  series: z.array(seriesInputSchema),
  groupBy: z.optional(z.string().min(1)),
  groupByKey: z.optional(z.string()),
  timeScale: z.optional(z.union([z.literal("full"), z.number().int()])),
  timeZone: z.string(),
});

export type TimeseriesInput = z.infer<typeof timeseriesInputSchema>;

/**
 * Whether an absent result value for a series truly means zero.
 *
 * Counts and sums are additive: no matching rows IS zero. Averages, extrema and
 * percentiles are not — they are only ever absent when there was no data, and
 * defaulting them to 0 fabricates a measurement (a 0% pass rate on a day an
 * evaluator never ran). Pipeline series re-aggregate per entity, so the
 * cross-entity pipeline aggregation decides additivity.
 */
export function isZeroWhenAbsentSeries(series: SeriesInput): boolean {
  if (series.pipeline) return series.pipeline.aggregation === "sum";
  return (
    series.aggregation === "cardinality" ||
    series.aggregation === "terms" ||
    series.aggregation === "sum"
  );
}

export type TracesPivotFilters = DeepRequired<
  z.infer<typeof sharedFiltersInputSchema>["filters"]
>;

export type TracesPivotFilterQuery = {
  name: string;
  field: string;
};

// ========== Analytics Result Types ==========
// Shared result types used by both ES and ClickHouse analytics services

/**
 * Timeseries result structure
 */
export type TimeseriesResult = AnalyticsTimeseriesResult;
export type TimeseriesBucket = AnalyticsTimeseriesBucket;

/**
 * Filter data result for dropdown options
 */
export interface FilterDataResult {
  options: Array<{
    field: string;
    label: string;
    count: number;
  }>;
}

/**
 * Top documents result for RAG analytics
 */
export type TopDocumentsResult = AnalyticsTopDocumentsResult;

/**
 * Feedbacks result
 */
export type FeedbacksResult = AnalyticsFeedbacksResult;
