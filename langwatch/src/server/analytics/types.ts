import type {
  AggregationsAggregationContainer,
  MappingRuntimeField,
} from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";
import type {
  ElasticSearchSpan,
  ElasticSearchTrace,
  Event,
  TraceCheck,
} from "../tracer/types";
import type { DeepRequired } from "../../utils/types";
import type { RotatingColorSet } from "../../utils/rotatingColors";
import type { FilterField } from "../filters/types";

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
  runtimeMappings?: Record<string, MappingRuntimeField>;
  allowedAggregations: AggregationTypes[];
  aggregation: (
    aggregation: AggregationTypes,
    key: string | undefined,
    subkey: string | undefined
  ) => Record<string, AggregationsAggregationContainer>;
  extractionPath: (
    aggregations: AggregationTypes,
    key: string | undefined,
    subkey: string | undefined
  ) => string;
};

export type AnalyticsGroup = {
  label: string;
  aggregation: (
    aggToGroup: Record<string, AggregationsAggregationContainer>
  ) => Record<string, AggregationsAggregationContainer>;
  extractionPath: () => string;
  labelsMapping?: (projectId: string) => Promise<Record<string, string>>;
};

export const aggregationTypesEnum = z.enum([
  "cardinality",
  "avg",
  "sum",
  "min",
  "max",
]);

export const allAggregationTypes = aggregationTypesEnum.options;

export const numericAggregationTypes = allAggregationTypes.filter(
  (agg) => agg !== "cardinality"
);

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
  filters: z.object({
    topics: z
      .object({
        topics: z.array(z.string()).optional(),
        subtopics: z.array(z.string()).optional(),
      })
      .optional(),
    metadata: z
      .object({
        user_id: z.array(z.string()).optional(),
        thread_id: z.array(z.string()).optional(),
        customer_id: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});

export type TracesPivotFilters = DeepRequired<
  z.infer<typeof sharedFiltersInputSchema>["filters"]
>;

export type TracesPivotFilterQuery = {
  name: string;
  field: string;
};

export type TracesPivot = {
  trace?: Omit<
    ElasticSearchTrace,
    "input" | "output" | "error" | "indexing_md5s"
  > & { input: { satisfaction_score?: number }; has_error: boolean };
  spans?: (Omit<
    ElasticSearchSpan,
    | "name"
    | "input"
    | "outputs"
    | "error"
    | "raw_response"
    | "params"
    | "contexts"
  > & {
    has_error?: boolean;
    params?: { temperature: number; stream: boolean };
  })[];
  contexts?: {
    document_id?: string;
    chunk_id?: string;
  }[];
  trace_checks?: (Omit<
    TraceCheck,
    "raw_result" | "error" | "trace_metadata"
  > & {
    has_error?: boolean;
  })[];
  events?: (Omit<Event, "trace_metadata" | "metrics" | "event_details"> & {
    metrics: { key: string; value: number }[];
    event_details: { key: string; value: string }[];
  })[];
};
