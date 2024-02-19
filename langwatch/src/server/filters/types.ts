import type { AggregationsAggregationContainer } from "@elastic/elasticsearch/lib/api/types";
import { z } from "zod";

export const filterFieldsEnum = z.enum([
  "metadata.user_id",
  "metadata.thread_id",
  "metadata.customer_id",
  "metadata.labels",
  "trace_checks.check_id",
  "events.event_type",
  "events.metrics.key",
  "events.event_details.key",
]);

export type FilterField = z.infer<typeof filterFieldsEnum>;

export type FilterDefinition = {
  listMatch: {
    requiresKey?: boolean;
    aggregation: (
      query: string | undefined,
      key: string | undefined
    ) => Record<string, AggregationsAggregationContainer>;
    extract: (
      result: Record<string, any>
    ) => { field: string; label: string; count: number }[];
  };
};
