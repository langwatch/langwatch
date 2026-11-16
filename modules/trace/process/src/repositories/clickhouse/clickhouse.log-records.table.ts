import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Log's records, a declared share trace reads (clickhouse-table-ownership.ts, log_records: owner
 * log, reader trace). Only the columns trace's log read and session groups select; a share's
 * windows apply on `TimeUnixMs` (ADR-202 Decided 28).
 */
export const logRecords = defineClickHouseTable({
  name: "log_records",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "CorrelationTraceId", "TimeUnixMs", "RecordId"],
  timeColumn: "TimeUnixMs",
  columns: {
    TenantId: column.string(),
    RecordId: column.fixedString({ length: 64 }),
    CorrelationTraceId: column.string(),
    CorrelationSpanId: column.string(),
    TimeUnixNano: column.uint64(),
    TimeUnixMs: column.dateTime64({ precision: 3 }),
    BodyText: column.nullable(column.string()),
    AttributesFlatJson: column.string(),
    ResourceAttributesFlatJson: column.string(),
    ScopeName: column.string(),
    ScopeVersion: column.string(),
    EventName: column.string(),
    ProviderSessionId: column.string(),
  },
});
