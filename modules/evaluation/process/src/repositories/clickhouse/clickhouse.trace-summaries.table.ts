import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Trace's summaries, read by evaluation under a named exception (clickhouse-table-ownership.ts,
 * trace_summaries: monitor-performance.repository.ts joins them). Only the columns that read uses.
 */
export const traceSummaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
