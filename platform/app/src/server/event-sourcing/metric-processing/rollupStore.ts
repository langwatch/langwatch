import {
  bindIdentifiers,
  type ClickHouseClient,
  clickhouseAppend,
  deriveAppendMapping,
} from "@langwatch/clickhouse";
import type { AppendStore, BatchContext } from "@langwatch/event-sourcing";
import { z } from "zod";
import { METRIC_ROLLUP_INTERVAL_MS } from "./constants";
import {
  affectedRollupBuckets,
  buildMetricRollups,
} from "./rollup/buildRollups";
import type { CanonicalMetricDataPoint, MetricRollupRow } from "./schema";
import { metricDataPointsTable, metricTimeRollupsTable } from "./table";

const DEFAULT_RETENTION_DAYS = 308;

/** The point columns a rollup recompute reads back; nothing heavier. */
export const METRIC_ROLLUP_READ_COLUMNS = [
  "TenantId",
  "PointId",
  "SeriesId",
  "MetricName",
  "MetricUnit",
  "MetricKind",
  "AggregationTemporality",
  "IsMonotonic",
  "StartTimeUnixNano",
  "TimeUnixNano",
  "TimeUnixMs",
  "ValueType",
  "ValueInt",
  "ValueDouble",
  "Count",
  "Sum",
  "Min",
  "Max",
  "ExplicitBounds",
  "BucketCounts",
  "ExponentialScale",
  "ExponentialZeroThreshold",
  "ZeroCount",
  "PositiveOffset",
  "PositiveBucketCounts",
  "NegativeOffset",
  "NegativeBucketCounts",
  "AcceptedAt",
] as const satisfies readonly (keyof typeof metricDataPointsTable.columns)[];

const READ_COLUMNS = METRIC_ROLLUP_READ_COLUMNS;
type ReadColumn = (typeof READ_COLUMNS)[number];

function decodeRow(row: readonly unknown[]): Record<ReadColumn, unknown> {
  const decoded: Record<string, unknown> = {};
  READ_COLUMNS.forEach((column, index) => {
    decoded[column] = metricDataPointsTable.columns[column].decode(row[index]);
  });
  return decoded as Record<ReadColumn, unknown>;
}

/**
 * The stored point, back in the shape the rollup builders take. Only the fields
 * `READ_COLUMNS` fetched carry a value; the rest are the empty forms the
 * builders already treat as absent.
 */
function toPoint(args: {
  cells: Record<ReadColumn, unknown>;
  organizationId: string;
}): CanonicalMetricDataPoint {
  const c = args.cells;
  const decimal = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    tenantId: c.TenantId as string,
    organizationId: args.organizationId,
    pointId: c.PointId as string,
    seriesId: c.SeriesId as string,
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributeKeys: [],
    scopeSchemaUrl: "",
    scopeName: "",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    metricName: c.MetricName as string,
    metricDescription: "",
    metricUnit: c.MetricUnit as string,
    metricKind: c.MetricKind as CanonicalMetricDataPoint["metricKind"],
    aggregationTemporality:
      c.AggregationTemporality as CanonicalMetricDataPoint["aggregationTemporality"],
    isMonotonic: c.IsMonotonic as boolean | null,
    pointAttributesJson: "[]",
    pointAttributeKeys: [],
    startTimeUnixNano: String(c.StartTimeUnixNano),
    timeUnixNano: String(c.TimeUnixNano),
    timeUnixMs: (c.TimeUnixMs as Date).getTime(),
    flags: 0,
    valueType: c.ValueType as CanonicalMetricDataPoint["valueType"],
    valueInt: decimal(c.ValueInt),
    valueDouble: c.ValueDouble as number | null,
    count: decimal(c.Count),
    sum: c.Sum as number | null,
    min: c.Min as number | null,
    max: c.Max as number | null,
    explicitBounds: c.ExplicitBounds as number[],
    bucketCounts: (c.BucketCounts as bigint[]).map(String),
    exponentialScale: c.ExponentialScale as number | null,
    exponentialZeroThreshold: c.ExponentialZeroThreshold as number | null,
    zeroCount: decimal(c.ZeroCount),
    positiveOffset: c.PositiveOffset as number | null,
    positiveBucketCounts: (c.PositiveBucketCounts as bigint[]).map(String),
    negativeOffset: c.NegativeOffset as number | null,
    negativeBucketCounts: (c.NegativeBucketCounts as bigint[]).map(String),
    summaryQuantilesJson: "[]",
    canonicalPayload: "",
    canonicalSizeBytes: 0,
    occurredAt: (c.TimeUnixMs as Date).getTime(),
    acceptedAt: (c.AcceptedAt as Date).getTime(),
  };
}

/** A rollup row plus the bookkeeping the table needs and the row does not carry. */
const stampedRollupSchema = z.object({
  tenantId: z.string(),
  seriesId: z.string(),
  metricName: z.string(),
  metricUnit: z.string(),
  metricKind: z.string(),
  aggregationTemporality: z.string(),
  isMonotonic: z.boolean().nullable(),
  gaugeLast: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  sum: z.number().nullable(),
  explicitBounds: z.array(z.number()),
  exponentialScale: z.number().nullable(),
  exponentialZeroThreshold: z.number().nullable(),
  positiveOffset: z.number(),
  negativeOffset: z.number(),
  resetCount: z.number(),
  gapCount: z.number(),
  sourcePointCount: z.number(),
  acceptedAt: z.number(),
  updatedAt: z.number(),
});

type StampedRollup = z.infer<typeof stampedRollupSchema> & {
  readonly bucketStartMs: number;
  readonly bucketEndMs: number;
  readonly count: string;
  readonly bucketCounts: string[];
  readonly zeroCount: string;
  readonly positiveBucketCounts: string[];
  readonly negativeBucketCounts: string[];
  readonly retentionDays: number;
};

const toRollupRow = deriveAppendMapping<
  StampedRollup,
  typeof metricTimeRollupsTable.columns
>({
  table: metricTimeRollupsTable,
  record: stampedRollupSchema,
  fill: {
    BucketStart: (row) => new Date(row.bucketStartMs),
    BucketEnd: (row) => new Date(row.bucketEndMs),
    Count: (row) => BigInt(row.count),
    BucketCounts: (row) => row.bucketCounts.map(BigInt),
    ZeroCount: (row) => BigInt(row.zeroCount),
    PositiveBucketCounts: (row) => row.positiveBucketCounts.map(BigInt),
    NegativeBucketCounts: (row) => row.negativeBucketCounts.map(BigInt),
    UpdatedAt: (row) => new Date(row.updatedAt),
    AcceptedAt: (row) => new Date(row.acceptedAt),
    _retention_days: (row) => row.retentionDays,
    _size_bytes: () => 0,
  },
});

/**
 * `metricTimeRollup`'s store: read the authoritative points around the new one,
 * recompute the buckets it can have changed, and write them whole. The read and
 * the recompute live here because a map's own function is pure and synchronous
 * by contract (ADR-098 §2).
 */
export function createMetricTimeRollupStore(
  client: ClickHouseClient,
): AppendStore<CanonicalMetricDataPoint> {
  const rollups = clickhouseAppend({
    client,
    table: metricTimeRollupsTable,
    toRow: toRollupRow,
  });

  async function query(args: {
    tenantId: string;
    sql: string;
    params: Record<string, unknown>;
    organizationId: string;
  }): Promise<CanonicalMetricDataPoint[]> {
    const result = await client.query({
      tenantId: args.tenantId,
      sql: args.sql,
      params: args.params,
    });
    const unique = new Map<string, CanonicalMetricDataPoint>();
    for (const row of result.rows) {
      const point = toPoint({
        cells: decodeRow(row),
        organizationId: args.organizationId,
      });
      unique.set(point.pointId, point);
    }
    return [...unique.values()];
  }

  /** The samples either side of a point, which decide the buckets it can move. */
  function neighbors(point: CanonicalMetricDataPoint) {
    const names = bindIdentifiers();
    const selection = names.list(READ_COLUMNS);
    const table = names.of(metricDataPointsTable.name);
    const scope =
      `${names.of("TenantId")} = {tenantId:String} AND ` +
      `${names.of("SeriesId")} = {seriesId:String}`;
    const order = `${names.of("TimeUnixNano")}`;
    const sql =
      `(SELECT ${selection} FROM ${table} FINAL WHERE ${scope} ` +
      `AND ${order} < {timeNano:UInt64} ORDER BY ${order} DESC LIMIT 1) ` +
      `UNION ALL ` +
      `(SELECT ${selection} FROM ${table} FINAL WHERE ${scope} ` +
      `AND ${order} > {timeNano:UInt64} ORDER BY ${order} ASC LIMIT 1)`;
    return query({
      tenantId: point.tenantId,
      organizationId: point.organizationId,
      sql,
      params: {
        ...names.params,
        tenantId: point.tenantId,
        seriesId: point.seriesId,
        timeNano: point.timeUnixNano,
      },
    });
  }

  /**
   * Every point in the affected buckets, each preceded by the sample the fold
   * differences it against. Buckets are fetched as their own narrow ranges: a
   * late point and a distant next sample would otherwise scan every partition
   * between them only to discard the rows.
   */
  function pointsForBuckets(
    point: CanonicalMetricDataPoint,
    buckets: ReadonlySet<number>,
  ) {
    const starts = [...buckets].sort((a, b) => a - b);
    const names = bindIdentifiers();
    const selection = names.list(READ_COLUMNS);
    const table = names.of(metricDataPointsTable.name);
    const scope =
      `${names.of("TenantId")} = {tenantId:String} AND ` +
      `${names.of("SeriesId")} = {seriesId:String}`;
    const time = names.of("TimeUnixMs");
    const params: Record<string, unknown> = {
      tenantId: point.tenantId,
      seriesId: point.seriesId,
    };
    const selects = starts.flatMap((start, index) => {
      params[`from${index}`] = new Date(start);
      params[`to${index}`] = new Date(start + METRIC_ROLLUP_INTERVAL_MS);
      return [
        `(SELECT ${selection} FROM ${table} FINAL WHERE ${scope} ` +
          `AND ${time} < {from${index}:DateTime64(3)} ` +
          `ORDER BY ${time} DESC LIMIT 1)`,
        `(SELECT ${selection} FROM ${table} FINAL WHERE ${scope} ` +
          `AND ${time} >= {from${index}:DateTime64(3)} ` +
          `AND ${time} < {to${index}:DateTime64(3)} ORDER BY ${time} ASC)`,
      ];
    });
    return query({
      tenantId: point.tenantId,
      organizationId: point.organizationId,
      sql: selects.join(" UNION ALL "),
      params: { ...names.params, ...params },
    });
  }

  async function rowsForSeries(
    points: CanonicalMetricDataPoint[],
  ): Promise<MetricRollupRow[]> {
    const affected = new Set<number>();
    for (const point of points) {
      for (const bucket of affectedRollupBuckets({
        points: await neighbors(point),
        insertedPoint: point,
      })) {
        affected.add(bucket);
      }
    }
    const authoritative = await pointsForBuckets(points[0]!, affected);
    return buildMetricRollups({
      points: authoritative,
      affectedBuckets: affected,
    });
  }

  return {
    kind: "append",
    async writeBatch(batch, context: BatchContext) {
      if (batch.length === 0) return;
      const bySeries = new Map<string, CanonicalMetricDataPoint[]>();
      for (const point of batch) {
        bySeries.set(point.seriesId, [
          ...(bySeries.get(point.seriesId) ?? []),
          point,
        ]);
      }
      // Earliest acceptance across the batch's own points: receipt time only
      // moves forward, so recomputing this bucket later derives the same
      // AcceptedAt and the two rows collapse instead of splitting partitions.
      const acceptedAt = Math.min(...batch.map((point) => point.acceptedAt));

      const rows: StampedRollup[] = [];
      for (const seriesPoints of bySeries.values()) {
        for (const row of await rowsForSeries(seriesPoints)) {
          rows.push({
            ...row,
            acceptedAt,
            retentionDays: context.retentionDays ?? DEFAULT_RETENTION_DAYS,
          });
        }
      }
      if (rows.length === 0) return;
      await rollups.writeBatch(rows, context);
    },
  };
}
