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
  "sentiment.input_sentiment",
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

// Schema for validating trigger filter JSON structure
export const triggerFiltersSchema = z.record(filterFieldsEnum, filterValueSchema);

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
