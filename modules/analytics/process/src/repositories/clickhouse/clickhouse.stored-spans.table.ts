/**
 * `stored_spans`, owned by trace and shared to analytics (clickhouse-table-ownership.ts): only the
 * columns analytics' filters, filter options, top documents, feedbacks and the
 * span-model partition read.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const storedSpans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  timeColumn: "StartTime",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId", "SpanId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    SpanId: column.string(),
    StartTime: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    SpanAttributes: column.stringMap(),
    Cost: column.nullable(column.float64()),
    NonBilledCost: column.nullable(column.float64()),
    "Events.Timestamp": column.array(column.dateTime64({ precision: 3 })),
    "Events.Name": column.array(column.lowCardinality(column.string())),
    "Events.Attributes": column.array(
      column.map({ key: column.lowCardinality(column.string()), value: column.string() }),
    ),
  },
});
