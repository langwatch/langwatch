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
  "trace_checks.check_id",
  "trace_checks.check_id.guardrails_only",
  "trace_checks.passed",
  "trace_checks.score",
  "trace_checks.state",
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
