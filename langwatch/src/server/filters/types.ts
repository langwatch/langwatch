import type {
  AggregationsAggregationContainer,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";

export const filterFieldsEnum = z.enum([
  "topics.topics",
  "topics.subtopics",
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "metadata.key",
  "metadata.value",
  "metadata.prompt_ids",
  "traces.origin",
  "traces.error",
  "spans.type",
  "spans.model",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "evaluations.label",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
  "annotations.hasAnnotation",
]);

export type FilterField = z.infer<typeof filterFieldsEnum>;

// Schema for trigger filter values - can be nested up to 2 levels deep
const filterValueSchema: z.ZodType<
  string[] | Record<string, string[]> | Record<string, Record<string, string[]>>
> = z.lazy(() =>
  z.union([
    z.array(z.string()),
    z.record(z.string(), z.array(z.string())),
    z.record(z.string(), z.record(z.string(), z.array(z.string()))),
  ]),
);

export type TriggerFilterValue = z.infer<typeof filterValueSchema>;
export type TriggerFilters = Partial<Record<FilterField, TriggerFilterValue>>;

// Schema for validating trigger filter JSON structure — rejects unknown fields
export const triggerFiltersSchema = z.record(filterFieldsEnum, filterValueSchema);

const validFilterFields = new Set<string>(filterFieldsEnum.options);
export const triggerFiltersRawSchema = z.record(z.string(), filterValueSchema);

export const isTriggerFilterField = (field: string): field is FilterField =>
  validFilterFields.has(field);

export const sanitizeTriggerFilters = (
  filters: Record<string, TriggerFilterValue>,
) => {
  const sanitizedFilters: TriggerFilters = {};
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (isTriggerFilterField(key)) {
      sanitizedFilters[key] = value;
      continue;
    }

    unknownFields.push(key);
  }

  return { sanitizedFilters, unknownFields };
};

export type FilterDefinition = {
  name: string;
  urlKey: string;
  query: (
    values: string[],
    key: string | undefined,
    subkey: string | undefined,
  ) => QueryDslQueryContainer;
  single?: boolean;
  type?: "numeric";
  requiresKey?: {
    filter: FilterField;
  };
  requiresSubkey?: {
    filter: FilterField;
  };
  listMatch: {
    aggregation: (
      query: string | undefined,
      key: string | undefined,
      subkey: string | undefined,
    ) => Record<string, AggregationsAggregationContainer>;
    extract: (
      result: Record<string, any>,
    ) => { field: string; label: string; count: number }[];
  };
};
