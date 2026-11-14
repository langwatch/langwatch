import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

/** Trace's per-span analytics projection, deduplicated on `ProjectedAt`. */
export const spanAnalytics = defineClickHouseTable({
  name: "span_analytics",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "ProjectedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    ParentSpanId: column.nullable(column.string()),
    StartTime: column.dateTime64({ precision: 3 }),
    EndTime: column.dateTime64({ precision: 3 }),
    DurationMs: column.uint64(),
    SpanName: column.lowCardinalityString(),
    SpanKind: column.uint8(),
    StatusCode: column.nullable(column.uint8()),
    Cost: column.nullable(column.float64()),
    NonBilledCost: column.nullable(column.float64()),
    SpanType: column.lowCardinalityString(),
    ErrorType: column.string(),
    RagContextCount: column.uint32(),
    InputHash: column.uint64(),
    DeploymentEnvironment: column.string(),
    ProjectedAt: column.dateTime64({ precision: 3 }),
  },
});
