import type {
  AggregationsAggregationContainer,
  MappingRuntimeField,
} from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";
import type { RotatingColorSet } from "../../utils/rotatingColors";
import type { DeepRequired, Unpacked } from "../../utils/types";
import { filterFieldsEnum, type FilterField } from "../filters/types";

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
};

export const aggregationTypesEnum = z.enum([
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
  filters: z.record(
    filterFieldsEnum,
    z.union([
      z.array(z.string()),
      z.record(z.string(), z.array(z.string())),
      z.record(z.string(), z.record(z.string(), z.array(z.string()))),
    ])
  ),
});

export type SharedFiltersInput = z.infer<typeof sharedFiltersInputSchema>;

export type TracesPivotFilters = DeepRequired<
  z.infer<typeof sharedFiltersInputSchema>["filters"]
>;

export type TracesPivotFilterQuery = {
  name: string;
  field: string;
};
