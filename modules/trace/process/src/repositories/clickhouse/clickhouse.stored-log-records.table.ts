import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * The legacy `stored_log_records` (goose 00002, recorded legacy in clickhouse-table-ownership.ts),
 * which trace reads as a fallback while a release still rolling out writes it. Only the columns
 * trace's log read selects and elects on; the engine replaces on `UpdatedAt`.
 */
export const storedLogRecords = defineClickHouseTable({
  name: "stored_log_records",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId", "ProjectionId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    Body: column.string(),
    Attributes: column.stringMap(),
    ResourceAttributes: column.stringMap(),
    ScopeName: column.string(),
    ScopeVersion: column.nullable(column.string()),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
