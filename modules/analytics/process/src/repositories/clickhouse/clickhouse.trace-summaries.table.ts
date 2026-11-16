/**
 * `trace_summaries`, owned by trace and shared to analytics (clickhouse-table-ownership.ts): only
 * the columns analytics' filters, pickers, top documents, feedbacks and metrics read. A trace's
 * latest version is elected by (TenantId, TraceId) on `UpdatedAt`, as the raw IN-tuple dedup did.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const columns = {
  TenantId: column.string(),
  TraceId: column.string(),
  OccurredAt: column.dateTime64({ precision: 3 }),
  UpdatedAt: column.dateTime64({ precision: 3 }),
  Attributes: column.stringMap(),
  ContainsErrorStatus: column.bool(),
  TopicId: column.nullable(column.string()),
  SubTopicId: column.nullable(column.string()),
  HasAnnotation: column.nullable(column.bool()),
  TraceName: column.string(),
  Models: column.array(column.string()),
  SpanCount: column.uint32(),
  CreatedAt: column.dateTime64({ precision: 3 }),
  TotalDurationMs: column.int64(),
  TimeToFirstTokenMs: column.nullable(column.uint32()),
  TotalCost: column.nullable(column.float64()),
  NonBilledCost: column.nullable(column.float64()),
  TotalPromptTokenCount: column.nullable(column.uint32()),
  TotalCompletionTokenCount: column.nullable(column.uint32()),
  TokensPerSecond: column.nullable(column.uint32()),
  ErrorMessage: column.nullable(column.string()),
};

/** The columns, so a read may alias the table and still hand it to the filter translator. */
export type TraceSummaryColumns = typeof columns;

export const traceSummaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns,
});
