/**
 * `session_metric_series`, owned by coding-agent (goose 00052):
 * ReplacingMergeTree(AsOf) over (TenantId, SessionId, SeriesId), partitioned by AsOf.
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

export const sessionMetricSeries = defineClickHouseTable({
  name: "session_metric_series",
  tenantColumn: "TenantId",
  versionColumn: "AsOf",
  sortKey: ["TenantId", "SessionId", "SeriesId"],
  columns: {
    TenantId: column.string(),
    SessionId: column.string(),
    SeriesId: column.string(),
    MetricName: column.lowCardinalityString(),
    MetricUnit: column.lowCardinalityString(),
    Agent: column.lowCardinalityString(),
    Attributes: column.stringMap(),
    Value: column.float64(),
    DataPointCount: column.uint32(),
    AsOf: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
    _retention_days: column.uint16(),
  },
});
