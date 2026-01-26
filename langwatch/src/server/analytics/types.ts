import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";
import type { RotatingColorSet } from "../../utils/rotatingColors";
import type { DeepRequired, Unpacked } from "../../utils/types";
import { type FilterField, filterFieldsEnum } from "../filters/types";

export type AnalyticsMetric = {
  label: string;
  colorSet: RotatingColorSet;
  format: string | ((value: number) => string);
  increaseIs: "good" | "bad" | "neutral";
  requiresKey?: {
    filter: FilterField;
    optional?: boolean;
  };
  requiresSubkey?: {
    filter: FilterField;
  };
  allowedAggregations: AggregationTypes[];
  aggregation: (
    index: number,
    aggregation: AggregationTypes,
    key: string | undefined,
    subkey: string | undefined,
  ) => Record<string, AggregationsAggregationContainer>;
  extractionPath: (
    index: number,
    aggregations: AggregationTypes,
    key: string | undefined,
    subkey: string | undefined,
  ) => string;
  quickwitSupport: boolean;
};

export type AnalyticsGroup = {
  label: string;
  requiresKey?: {
    filter: FilterField;
    optional?: boolean;
  };
  aggregation: (
    aggToGroup: Record<string, AggregationsAggregationContainer>,
    key?: string,
  ) => Record<string, AggregationsAggregationContainer>;
  extractionPath: () => string;
  quickwitSupport: boolean;
};

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

export const numericAggregationTypes: AggregationTypes[] = [
  "avg",
  "sum",
  "min",
  "max",
];

export const percentileAggregationTypes = ["median", "p99", "p95", "p90"] as (
  | "median"
  | "p99"
  | "p95"
  | "p90"
)[] satisfies AggregationTypes[];

export type PercentileAggregationTypes = Unpacked<
  typeof percentileAggregationTypes
>;

export type AggregationTypes = z.infer<typeof aggregationTypesEnum>;

export const pipelineFieldsEnum = z.enum([
  "trace_id",
  "user_id",
  "thread_id",
  "customer_id",
]);

export type PipelineFields = z.infer<typeof pipelineFieldsEnum>;

export const pipelineAggregationTypesEnum = z.enum([
  "sum",
  "avg",
  "min",
  "max",
]);

export type PipelineAggregationTypes = z.infer<
  typeof pipelineAggregationTypesEnum
>;

export const sharedFiltersInputSchema = z.object({
  projectId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  query: z.string().optional(),
  filters: z
    .record(
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
export interface TimeseriesResult {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
}

export interface TimeseriesBucket {
  date: string;
  [key: string]: number | string | Record<string, Record<string, number>>;
}

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
export interface TopDocumentsResult {
  topDocuments: Array<{
    documentId: string;
    count: number;
    traceId: string;
    content?: string;
  }>;
  totalUniqueDocuments: number;
}

/**
 * Feedbacks result
 */
export interface FeedbacksResult {
  events: Array<{
    event_id: string;
    event_type: string;
    project_id?: string;
    trace_id: string;
    timestamps: {
      started_at: number;
      inserted_at: number;
      updated_at: number;
    };
    metrics?: Array<{ key: string; value: number }>;
    event_details?: Array<{ key: string; value: string }>;
  }>;
}

/**
 * Analytics backend interface for dependency injection
 */
export interface AnalyticsBackend {
  getTimeseries(input: import("./registry").TimeseriesInputType): Promise<TimeseriesResult>;
  getDataForFilter(
    projectId: string,
    field: FilterField,
    startDate: number,
    endDate: number,
    filters: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
    key?: string,
    subkey?: string,
    searchQuery?: string,
  ): Promise<FilterDataResult>;
  getTopUsedDocuments(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<TopDocumentsResult>;
  getFeedbacks(
    projectId: string,
    startDate: number,
    endDate: number,
    filters?: Partial<
      Record<
        FilterField,
        | string[]
        | Record<string, string[]>
        | Record<string, Record<string, string[]>>
      >
    >,
  ): Promise<FeedbacksResult>;
  isAvailable(): boolean;
}
