/**
 * `trace_analytics`, owned by trace, shared to analytics (clickhouse-table-ownership.ts): only the
 * columns analytics' recency read names. It elects a trace's latest version by (TenantId, TraceId),
 * as the raw read did; trace's own descriptor keys on the engine's ORDER BY instead.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const traceAnalytics = defineClickHouseTable({
  name: "trace_analytics",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    Origin: column.string(),
  },
});
