/**
 * The chart builder's vocabulary: every metric and grouping a series may name, and the
 * series and timeseries shapes built from them. Labels and formatters stay in the browser
 * kit, keyed by these names.
 */
import { z } from "zod";

import { filterFieldsEnum } from "./analytics.filter-field.ts";
import { analyticsAggregationSchema, analyticsPipelineSchema } from "./analytics.timeseries.ts";

export const analyticsChartMetricSchema = z.enum([
  "metadata.trace_id",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.span_type",
  "sentiment.thumbs_up_down",
  "performance.completion_time",
  "performance.first_token",
  "performance.total_cost",
  "performance.cost_billed",
  "performance.cost_non_billed",
  "performance.prompt_tokens",
  "performance.completion_tokens",
  "performance.cache_read_tokens",
  "performance.cache_write_tokens",
  "performance.reasoning_tokens",
  "performance.total_processed_tokens",
  "performance.total_tokens",
  "performance.tokens_per_second",
  "events.event_type",
  "events.event_score",
  "events.event_details",
  "evaluations.evaluation_score",
  "evaluations.evaluation_pass_rate",
  "evaluations.evaluation_runs",
  "threads.average_duration_per_thread",
]);
export type AnalyticsChartMetric = z.infer<typeof analyticsChartMetricSchema>;

export const analyticsChartGroupSchema = z.enum([
  "topics.topics",
  "traces.trace_name",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.model",
  "metadata.span_type",
  "sentiment.thumbs_up_down",
  "events.event_type",
  "evaluations.evaluation_passed",
  "evaluations.evaluation_label",
  "evaluations.evaluation_processing_state",
  "error.has_error",
]);
export type AnalyticsChartGroup = z.infer<typeof analyticsChartGroupSchema>;

/** One charted series: a metric, how it aggregates, and what narrows it. */
export const analyticsChartSeriesSchema = z.object({
  metric: analyticsChartMetricSchema,
  key: z.optional(z.string()),
  subkey: z.optional(z.string()),
  aggregation: analyticsAggregationSchema,
  pipeline: z.optional(
    z.object({
      field: analyticsPipelineSchema.shape.field,
      aggregation: analyticsPipelineSchema.shape.aggregation,
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
export type AnalyticsChartSeries = z.infer<typeof analyticsChartSeriesSchema>;

/** The series a chart asks for, grouped and bucketed. */
export const analyticsChartTimeseriesSchema = z.object({
  query: z.optional(z.string()),
  series: z.array(analyticsChartSeriesSchema),
  groupBy: z.optional(analyticsChartGroupSchema),
  groupByKey: z.optional(z.string()),
  timeScale: z.optional(z.union([z.literal("full"), z.number().int()])),
  timeZone: z.string(),
});
export type AnalyticsChartTimeseries = z.infer<typeof analyticsChartTimeseriesSchema>;
