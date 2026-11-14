/**
 * `coding_agent_trace_sessions`, owned by coding-agent (goose 00051):
 * ReplacingMergeTree(UpdatedAt) over (TenantId, TraceId), partitioned by OccurredAt.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const codingAgentTraceSessions = defineClickHouseTable({
  name: "coding_agent_trace_sessions",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SessionId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    _retention_days: column.uint16(),
  },
});
