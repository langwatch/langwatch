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
  "traces.error",
  "spans.type",
  "spans.model",
  "evaluations.evaluator_id",
  "evaluations.evaluator_id.guardrails_only",
  "evaluations.passed",
  "evaluations.score",
  "evaluations.state",
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
]);

export type FilterField = z.infer<typeof filterFieldsEnum>;

export type FilterDefinition = {
  name: string;
  urlKey: string;
  query: (
    values: string[],
    key: string | undefined,
    subkey: string | undefined
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
      subkey: string | undefined
    ) => Record<string, AggregationsAggregationContainer>;
    extract: (
      result: Record<string, any>
    ) => { field: string; label: string; count: number }[];
  };
};
