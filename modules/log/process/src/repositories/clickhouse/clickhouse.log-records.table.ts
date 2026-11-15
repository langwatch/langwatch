import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Log's own records (goose 00050), as far as log reads them: the sort key and the stored size the
 * storage meter sums. `TimeUnixMs` partitions it but is no tenant-scope time column.
 */
export const logRecords = defineClickHouseTable({
  name: "log_records",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "CorrelationTraceId", "TimeUnixMs", "RecordId"],
  columns: {
    TenantId: column.string(),
    CorrelationTraceId: column.string(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    RecordId: column.fixedString({ length: 64 }),
    _size_bytes: column.uint32(),
  },
});
