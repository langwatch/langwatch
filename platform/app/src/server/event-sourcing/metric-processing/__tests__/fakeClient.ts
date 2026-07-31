import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import { METRIC_ROLLUP_READ_COLUMNS } from "../rollupStore";
import type { CanonicalMetricDataPoint } from "../schema";
import { metricDataPointsTable } from "../table";

export interface FakeClient extends ClickHouseClient {
  readonly insertCalls: Array<{
    table: string;
    rows: unknown[][];
    columns: readonly string[];
    target: unknown;
  }>;
  readonly queries: string[];
  /** Points the rollup store's read-back should find already stored. */
  stored: CanonicalMetricDataPoint[];
}

/**
 * Encodes a point the way `metric_data_points` would return it, so a read-back
 * goes through the same column codecs the write does.
 */
function wireRow(point: CanonicalMetricDataPoint): unknown[] {
  const cells: Record<string, unknown> = {
    TenantId: point.tenantId,
    PointId: point.pointId,
    SeriesId: point.seriesId,
    MetricName: point.metricName,
    MetricUnit: point.metricUnit,
    MetricKind: point.metricKind,
    AggregationTemporality: point.aggregationTemporality,
    IsMonotonic: point.isMonotonic,
    StartTimeUnixNano: BigInt(point.startTimeUnixNano),
    TimeUnixNano: BigInt(point.timeUnixNano),
    TimeUnixMs: new Date(point.timeUnixMs),
    ValueType: point.valueType,
    ValueInt: point.valueInt === null ? null : BigInt(point.valueInt),
    ValueDouble: point.valueDouble,
    Count: point.count === null ? null : BigInt(point.count),
    Sum: point.sum,
    Min: point.min,
    Max: point.max,
    ExplicitBounds: point.explicitBounds,
    BucketCounts: point.bucketCounts.map(BigInt),
    ExponentialScale: point.exponentialScale,
    ExponentialZeroThreshold: point.exponentialZeroThreshold,
    ZeroCount: point.zeroCount === null ? null : BigInt(point.zeroCount),
    PositiveOffset: point.positiveOffset,
    PositiveBucketCounts: point.positiveBucketCounts.map(BigInt),
    NegativeOffset: point.negativeOffset,
    NegativeBucketCounts: point.negativeBucketCounts.map(BigInt),
    AcceptedAt: new Date(point.acceptedAt),
  };
  return METRIC_ROLLUP_READ_COLUMNS.map((column) =>
    metricDataPointsTable.columns[column].encode(cells[column]),
  );
}

export function createFakeClient(): FakeClient {
  const insertCalls: FakeClient["insertCalls"] = [];
  const queries: string[] = [];
  const client: FakeClient = {
    insertCalls,
    queries,
    stored: [],
    async query(options: QueryOptions) {
      queries.push(options.sql);
      return { rows: client.stored.map(wireRow) };
    },
    stream(_options: QueryOptions): AsyncIterable<unknown[][]> {
      throw new Error("not used by these projections");
    },
    async insert(options) {
      insertCalls.push({
        table: options.table,
        rows: options.rows,
        columns: options.columns,
        target: options.target,
      });
    },
    async close() {},
  };
  return client;
}

/** The decoded cell of one inserted row, read back through the table's codec. */
export function insertedCell(args: {
  client: FakeClient;
  table: string;
  column: string;
  row?: number;
}): unknown {
  const call = args.client.insertCalls.find((c) => c.table === args.table);
  if (!call) throw new Error(`no insert against ${args.table}`);
  return call.rows[args.row ?? 0]![call.columns.indexOf(args.column)];
}
