import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const CLICKHOUSE_EXPLAIN_PIPELINE_NAME = "ops_clickhouse_explain";
export const CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE = "clickhouse_explain";
export const CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_TYPE = "lw.ops.clickhouse_explain.requested";
export const CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_VERSION = "2026-11-14";
/** No operator user stands behind the secret, so every request files under one tenant. */
export const CLICKHOUSE_EXPLAIN_TENANT_ID = "ops_clickhouse_explain";

/** The request id alone: the query waits in the result store, never in the event log. */
export const clickhouseExplainRequestedDataSchema = z.object({ requestId: z.string().min(1) });
export type ClickHouseExplainRequested = z.infer<typeof clickhouseExplainRequestedDataSchema>;

export const clickhouseExplainRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_TYPE),
  version: z.literal(CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_VERSION),
  data: clickhouseExplainRequestedDataSchema,
});
export type ClickHouseExplainRequestedEvent = z.infer<typeof clickhouseExplainRequestedEventSchema>;
