/**
 * `metric_data_points`, owned by metric (goose 00049, clickhouse-table-ownership):
 * ReplacingMergeTree(DedupVersion) over (TenantId, SeriesId, TimeUnixMs, TimeUnixNano, PointId),
 * partitioned by toYearWeek(TimeUnixMs) (not a fence time column, so no `timeColumn`).
 */
import { column, defineClickHouseTable } from "@langwatch/clickhouse-client/builder";

const moment = () => column.dateTime64({ precision: 3 });
const key = () => column.fixedString({ length: 64 });

export const metricDataPoints = defineClickHouseTable({
  name: "metric_data_points",
  tenantColumn: "TenantId",
  versionColumn: "DedupVersion",
  sortKey: ["TenantId", "SeriesId", "TimeUnixMs", "TimeUnixNano", "PointId"],
  columns: {
    TenantId: column.string(),
    PointId: key(),
    SeriesId: key(),
    ResourceSchemaUrl: column.string(),
    ResourceAttributesJson: column.string(),
    ResourceAttributeKeys: column.stringArray(),
    ScopeSchemaUrl: column.string(),
    ScopeName: column.string(),
    ScopeVersion: column.string(),
    ScopeAttributesJson: column.string(),
    ScopeAttributeKeys: column.stringArray(),
    MetricName: column.string(),
    MetricDescription: column.string(),
    MetricUnit: column.string(),
    MetricKind: column.lowCardinalityString(),
    AggregationTemporality: column.lowCardinalityString(),
    IsMonotonic: column.nullable(column.bool()),
    PointAttributesJson: column.string(),
    PointAttributeKeys: column.stringArray(),
    StartTimeUnixNano: column.uint64(),
    TimeUnixNano: column.uint64(),
    TimeUnixMs: moment(),
    Flags: column.uint32(),
    ValueType: column.lowCardinalityString(),
    ValueInt: column.nullable(column.int64()),
    ValueDouble: column.nullable(column.float64()),
    Count: column.nullable(column.uint64()),
    Sum: column.nullable(column.float64()),
    Min: column.nullable(column.float64()),
    Max: column.nullable(column.float64()),
    ExplicitBounds: column.array(column.float64()),
    BucketCounts: column.array(column.uint64()),
    ExponentialScale: column.nullable(column.int32()),
    ExponentialZeroThreshold: column.nullable(column.float64()),
    ZeroCount: column.nullable(column.uint64()),
    PositiveOffset: column.nullable(column.int32()),
    PositiveBucketCounts: column.array(column.uint64()),
    NegativeOffset: column.nullable(column.int32()),
    NegativeBucketCounts: column.array(column.uint64()),
    SummaryQuantilesJson: column.string(),
    CanonicalPayload: column.string(),
    OccurredAt: moment(),
    AcceptedAt: moment(),
    WrittenAt: moment(),
    DedupVersion: column.uint64(),
  },
});
