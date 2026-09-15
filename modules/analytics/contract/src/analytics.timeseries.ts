import { z } from "zod";

export const analyticsFilterValueSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.array(z.string())),
  z.record(z.string(), z.record(z.string(), z.array(z.string()))),
]);

export const analyticsAggregationSchema = z.enum([
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

export const analyticsPipelineSchema = z
  .object({
    field: z.enum(["trace_id", "user_id", "thread_id", "customer_id"]),
    aggregation: z.enum(["sum", "avg", "min", "max"]),
  })
  .strict();

export const analyticsSeriesSchema = z
  .object({
    metric: z.string().min(1),
    key: z.string().optional(),
    subkey: z.string().optional(),
    aggregation: analyticsAggregationSchema,
    pipeline: analyticsPipelineSchema.optional(),
    filters: z.record(z.string(), analyticsFilterValueSchema).optional(),
    asPercent: z.boolean().optional(),
  })
  .strict();

export const analyticsTimeseriesInputSchema = z
  .object({
    projectId: z.string(),
    startDate: z.number().positive(),
    endDate: z.number().positive(),
    query: z.string().optional(),
    filters: z.record(z.string(), analyticsFilterValueSchema).default({}),
    traceIds: z.array(z.string()).optional(),
    negateFilters: z.boolean().optional(),
    series: z.array(analyticsSeriesSchema),
    groupBy: z.string().min(1).optional(),
    groupByKey: z.string().optional(),
    timeScale: z.union([z.literal("full"), z.number().int()]).optional(),
    timeZone: z.string(),
  })
  .strict();

export const analyticsTableSchema = z.enum([
  "trace_analytics_rollup",
  "trace_analytics",
  "trace_summaries",
  "evaluation_analytics_rollup",
  "evaluation_analytics",
  "evaluation_runs",
]);

export const analyticsTimeseriesBucketSchema = z
  .object({
    date: z.string(),
  })
  .catchall(
    z.union([z.number(), z.string(), z.record(z.string(), z.record(z.string(), z.number()))]),
  );

export const analyticsTimeseriesResultSchema = z
  .object({
    previousPeriod: z.array(analyticsTimeseriesBucketSchema),
    currentPeriod: z.array(analyticsTimeseriesBucketSchema),
  })
  .strict();

export const analyticsReadInputSchema = z
  .object({
    projectId: z.string(),
    startDate: z.number().positive(),
    endDate: z.number().positive(),
    filters: z.record(z.string(), analyticsFilterValueSchema).optional(),
  })
  .strict();

export type AnalyticsAggregation = z.infer<typeof analyticsAggregationSchema>;
export type AnalyticsPipeline = z.infer<typeof analyticsPipelineSchema>;
export type AnalyticsSeries = z.infer<typeof analyticsSeriesSchema>;
export type AnalyticsTimeseriesInput = z.infer<typeof analyticsTimeseriesInputSchema>;
export type AnalyticsTable = z.infer<typeof analyticsTableSchema>;
export type AnalyticsTimeseriesBucket = z.infer<typeof analyticsTimeseriesBucketSchema>;
/** Compatibility name for existing analytics consumers; the schema above is canonical. */
export type TimeseriesBucket = AnalyticsTimeseriesBucket;
export type AnalyticsTimeseriesResult = z.infer<typeof analyticsTimeseriesResultSchema>;

export type AnalyticsFilterValue =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

export type AnalyticsFilters = Partial<Record<string, AnalyticsFilterValue>>;
export type AnalyticsReadInput = z.infer<typeof analyticsReadInputSchema>;

export const analyticsFeedbackEventSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  project_id: z.string().optional(),
  trace_id: z.string(),
  timestamps: z.object({
    started_at: z.number(),
    inserted_at: z.number(),
    updated_at: z.number(),
  }),
  metrics: z.array(z.object({ key: z.string(), value: z.number() })).optional(),
  event_details: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
});
export type AnalyticsFeedbackEvent = z.infer<typeof analyticsFeedbackEventSchema>;

export const analyticsFeedbacksResultSchema = z.object({
  events: z.array(analyticsFeedbackEventSchema),
});
export type AnalyticsFeedbacksResult = z.infer<typeof analyticsFeedbacksResultSchema>;

export const analyticsTopDocumentSchema = z.object({
  documentId: z.string(),
  count: z.number(),
  traceId: z.string(),
  content: z.string().optional(),
});
export type AnalyticsTopDocument = z.infer<typeof analyticsTopDocumentSchema>;

export const analyticsTopDocumentsResultSchema = z.object({
  topDocuments: z.array(analyticsTopDocumentSchema),
  totalUniqueDocuments: z.number(),
});
export type AnalyticsTopDocumentsResult = z.infer<typeof analyticsTopDocumentsResultSchema>;

/** One offered value for a filter field, exactly as the picker renders it. */
export const analyticsFilterOptionSchema = z.object({
  field: z.string(),
  label: z.string(),
  count: z.number(),
});
export type AnalyticsFilterOption = z.infer<typeof analyticsFilterOptionSchema>;

/** What `dataForFilter` answers with. */
export const analyticsFilterOptionsResultSchema = z.object({
  options: z.array(analyticsFilterOptionSchema),
});

export const analyticsTimeseriesRowSchema = z
  .object({
    // ClickHouse JSONEachRow is an members boundary, not an API input.
    // Keep this deliberately permissive: the displaced parser treated a bad
    // period/date cell as the legacy previous/empty bucket rather than turning a
    // formerly readable response into a transport error.
    period: z.unknown().optional(),
    date: z.unknown().optional(),
    group_key: z.unknown().optional(),
  })
  .catchall(z.unknown());

export type AnalyticsTimeseriesRow = z.infer<typeof analyticsTimeseriesRowSchema>;

export type AnalyticsMetricSource = "trace" | "evaluation";

export function getMetricSource(metric: string): AnalyticsMetricSource | undefined {
  return metric.startsWith("evaluations.")
    ? "evaluation"
    : metric.startsWith("metadata.") ||
        metric.startsWith("performance.") ||
        metric.startsWith("events.") ||
        metric.startsWith("sentiment.") ||
        metric.startsWith("threads.") ||
        metric.startsWith("topics.") ||
        metric.startsWith("traces.")
      ? "trace"
      : void 0;
}

export function buildSeriesName(series: AnalyticsSeries, index: number): string {
  const aggregation = series.aggregation === "terms" ? "cardinality" : series.aggregation;
  if (series.pipeline) {
    return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
  }
  if (series.key) return `${index}/${series.metric}/${aggregation}/${series.key}`;
  return `${index}/${series.metric}/${aggregation}`;
}

export function isZeroWhenAbsentSeries(series: AnalyticsSeries): boolean {
  if (series.pipeline) return series.pipeline.aggregation === "sum";
  return (
    series.aggregation === "cardinality" ||
    series.aggregation === "terms" ||
    series.aggregation === "sum"
  );
}
