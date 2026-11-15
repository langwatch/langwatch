import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * The event-sourcing append log (goose 00002, 00032), replaced on `EventTimestamp` within its
 * sort key. No time column: the partition key, `EventOccurredAt`, is epoch ms in a UInt64.
 */
export const eventLog = defineClickHouseTable({
  name: "event_log",
  tenantColumn: "TenantId",
  versionColumn: "EventTimestamp",
  sortKey: ["TenantId", "AggregateType", "AggregateId", "IdempotencyKey"],
  columns: {
    TenantId: column.string(),
    IdempotencyKey: column.string(),
    AggregateType: column.lowCardinalityString(),
    AggregateId: column.string(),
    EventId: column.string(),
    EventType: column.lowCardinalityString(),
    EventVersion: column.lowCardinalityString(),
    EventTimestamp: column.uint64(),
    CreatedAt: column.dateTime64({ precision: 3 }),
    EventPayload: column.string(),
    ProcessingTraceparent: column.string(),
    EventOccurredAt: column.uint64(),
    _retention_days: column.uint16(),
    _size_bytes: column.uint32(),
  },
});
