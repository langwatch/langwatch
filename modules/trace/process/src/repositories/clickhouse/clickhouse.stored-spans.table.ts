import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/**
 * Trace's spans (goose 00002 onward), one row per span version. The engine merges on
 * `StartTime`, but every read elects the latest `UpdatedAt`, as the fenced reader's election did.
 * Of the nested groups only `Events.*` is declared: no read selects `Links.*`.
 */
export const storedSpans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    ProjectionId: column.string(),
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    ParentSpanId: column.nullable(column.string()),
    ParentTraceId: column.nullable(column.string()),
    ParentIsRemote: column.nullable(column.uint8()),
    Sampled: column.uint8(),
    StartTime: column.dateTime64({ precision: 3 }),
    EndTime: column.dateTime64({ precision: 3 }),
    DurationMs: column.uint64(),
    SpanName: column.lowCardinalityString(),
    SpanKind: column.uint8(),
    ServiceName: column.lowCardinalityString(),
    ResourceAttributes: column.stringMap(),
    SpanAttributes: column.stringMap(),
    StatusCode: column.nullable(column.uint8()),
    StatusMessage: column.nullable(column.string()),
    ScopeName: column.string(),
    ScopeVersion: column.nullable(column.string()),
    DroppedAttributesCount: column.uint32(),
    DroppedEventsCount: column.uint32(),
    DroppedLinksCount: column.uint32(),
    Cost: column.nullable(column.float64()),
    NonBilledCost: column.nullable(column.float64()),
    "Events.Timestamp": column.array(column.dateTime64({ precision: 3 })),
    "Events.Name": column.array(column.lowCardinality(column.string())),
    "Events.Attributes": column.array(
      column.map({ key: column.lowCardinality(column.string()), value: column.string() }),
    ),
    CreatedAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});
