import { defineCommand } from "@langwatch/eventing";

import {
  CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE,
  CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_TYPE,
  CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_VERSION,
  clickhouseExplainRequestedDataSchema,
} from "./ops-clickhouse-explain.events.ts";

/** Hands an accepted EXPLAIN to a worker; the request is its own aggregate, so a resend is one. */
export const RequestClickHouseExplainCommand = defineCommand({
  commandType: "lw.ops.clickhouse_explain.request",
  eventType: CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_TYPE,
  eventVersion: CLICKHOUSE_EXPLAIN_REQUESTED_EVENT_VERSION,
  aggregateType: CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE,
  schema: clickhouseExplainRequestedDataSchema,
  aggregateId: ({ requestId }) => requestId,
  idempotencyKey: ({ requestId }) => `clickhouse_explain:${requestId}`,
  makeJobId: ({ requestId }) => `clickhouse_explain:${requestId}`,
});
