import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  affectedRollupBuckets,
  buildMetricRollups,
  comparePoints,
  type MetricRollupSourcePoint,
  type MetricSequencePoint,
  METRIC_ROLLUP_INTERVAL_MS,
  type CanonicalMetricDataPoint,
  type MetricRollupRow,
} from "@langwatch/metric-contract";
import { createLogger } from "@langwatch/observability";

import {
  type BucketReadRange,
  type BucketSeek,
  bucketReadRanges,
  newestVersions,
  payloadWindows,
  pointsForBucketSeeks,
  type SeriesWindow,
} from "../../rules/metric-rollup-bucket-reads.rules.ts";
import {
  MetricDataPointAppendRepository,
  type MetricDataPointBulkWrite,
  type MetricDataPointWrite,
} from "../metric-data-point-append.repository.ts";
import {
  metricPointFromSeekRow,
  metricRawRow,
  metricRollupRow,
  metricRollupSourceFromRow,
  metricSeriesRow,
  metricUsageEstimateRow,
  validateMetricPoint,
  ROLLUP_SELECT,
  type RollupSourceRow,
  SEEK_SELECT,
  type SeekMetricRow,
} from "./clickhouse.metric-data-point.mapper.ts";

export interface MetricClickHouseClient {
  insert(params: {
    table: string;
    /**
     * Read-only on purpose: nothing here mutates the batch it is handed, and saying so is what
     * lets a caller holding a `readonly` row array — the Eventing ClickHouse client a
     * background worker composes from — satisfy this port without copying every insert.
     */
    values: readonly unknown[];
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown>;
  query(params: {
    query: string;
    query_params?: Record<string, unknown>;
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    SKIP_TENANT_CHECK?: true;
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
}

export type MetricClickHouseClientResolver = (tenantId: string) => Promise<MetricClickHouseClient>;

/**
 * Adapts the process's routed `clickhouse` member to Metric's tenant-resolved
 * client, so the append/read repositories below keep their own shape.
 */
function metricClickHouseResolver(
  clickhouse: ClickHouseQueryClient,
): MetricClickHouseClientResolver {
  return (tenantId) =>
    Promise.resolve<MetricClickHouseClient>({
      async insert(params) {
        await clickhouse.insert({
          tenantId,
          table: params.table,
          rows: params.values as readonly Record<string, unknown>[],
        });
        return undefined;
      },
      async query(params) {
        const result = await clickhouse.query<Record<string, unknown>>({
          tenantId,
          sql: params.query,
          ...(params.query_params ? { params: params.query_params } : {}),
          SKIP_TENANT_CHECK: params.SKIP_TENANT_CHECK,
        });
        return { json: async <T = unknown>() => result.rows as T[] };
      },
    });
}

const logger = createLogger("langwatch:app-layer:metrics:metric-data-point-repository");

const INSERT_SETTINGS = { async_insert: 1, wait_for_async_insert: 1 } as const;

/**
 * The upper cap on what one rollup query folds together: series per set of array parameters for
 * the successor read, and — halved — buckets per request for the affected-bucket read.
 */
const SEEKS_PER_QUERY = 64;

/**
 * The ceiling one successor request's encoded `param_*` entries must stay under, measured the
 * way `@clickhouse/client` measures it: `formatQueryParams` per value, then `new
 * URLSearchParams(entries).toString().length`.
 */
const SUCCESSOR_PARAM_BUDGET_CHARS = 3500;

/**
 * How far behind a bucket the first predecessor seek looks before the second one widens to the
 * retention window. An hour, which is two orders of magnitude more than the rollup interval and
 * so covers any series still being written to, however coarsely it is scraped.
 */
const PREDECESSOR_LOOKBACK_MS = 60 * 60 * 1000;

/** A payload row with the version FINAL would have kept the newest of. */
type VersionedRollupSourceRow = RollupSourceRow & { DedupVersion: string };

/**
 * The seeks whose predecessor the near pass failed to find.
 */
function seeksWithoutPredecessor({
  seeks,
  points,
  lookbackMs,
}: {
  seeks: readonly { seriesId: string; start: number }[];
  points: Iterable<MetricSequencePoint>;
  lookbackMs: number;
}): { seriesId: string; start: number }[] {
  const seenBySeries = new Map<string, number[]>();
  for (const point of points) {
    const times = seenBySeries.get(point.seriesId);
    if (times) times.push(point.timeUnixMs);
    else seenBySeries.set(point.seriesId, [point.timeUnixMs]);
  }
  return seeks.filter(
    ({ seriesId, start }) =>
      !(seenBySeries.get(seriesId) ?? []).some(
        (timeUnixMs) => timeUnixMs < start && timeUnixMs >= start - lookbackMs,
      ),
  );
}

/**
 * A series' chunk points reduced to the two that bound them. The successor read
 * needs nothing else: everything between them it reads wholesale, and only the
 * newest needs a look past the end of the chunk.
 */
interface SeriesSpan {
  seriesId: string;
  first: CanonicalMetricDataPoint;
  last: CanonicalMetricDataPoint;
}

/**
 * The append half of metric persistence, over one tenant-keyed client. Every statement below is
 * tenant-scoped, so one resolver is all it can use: a point names its tenant and the row it
 * becomes is written to that tenant's instance.
 */
export class ClickHouseMetricDataPointAppendRepository extends MetricDataPointAppendRepository {
  private readonly resolveClient: MetricClickHouseClientResolver;
  private readonly defaultRetentionDays: number;

  private constructor({
    resolveClient,
    defaultRetentionDays,
  }: {
    resolveClient: MetricClickHouseClientResolver;
    defaultRetentionDays: number;
  }) {
    super();
    this.resolveClient = resolveClient;
    this.defaultRetentionDays = defaultRetentionDays;
  }

  /** The routed `clickhouse` member, as the tenant-resolved client this repository reads. */
  static resolverOver(clickhouse: ClickHouseQueryClient): MetricClickHouseClientResolver {
    return metricClickHouseResolver(clickhouse);
  }

  static create(options: {
    resolveClient: MetricClickHouseClientResolver;
    defaultRetentionDays: number;
  }): ClickHouseMetricDataPointAppendRepository {
    return new ClickHouseMetricDataPointAppendRepository(options);
  }

  async ensureDataPoint(args: MetricDataPointWrite): Promise<void> {
    await this.ensureDataPoints({
      points: [args.point],
      retentionDays: args.retentionDays,
    });
  }

  /** One round trip per table, however many points the chunk holds. */
  async ensureDataPoints({
    points,
    retentionDays = this.defaultRetentionDays,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      validateMetricPoint({
        point,
        operation: "ClickHouseMetricDataPointAppendRepository.ensureDataPoints",
      });
    }
    const client = await this.resolveClient(points[0]!.tenantId);
    try {
      // Raw must be authoritative before any derived or shadow write.
      await client.insert({
        table: "metric_data_points",
        values: points.map((point) => metricRawRow({ point, retentionDays })),
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
      await client.insert({
        table: "metric_usage_estimates",
        values: points.map((point) => metricUsageEstimateRow(point)),
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
    } catch (error) {
      // Warning, not error: this rethrows, so the caller decides the outcome.
      // Under the worker queue that caller retries, and most of these attempts
      // land on a later one. The error-level record belongs to whoever gives
      // up — GroupQueue's "Group blocked after exhausted retries".
      // See specs/observability/retryable-failure-log-level.feature.
      logger.warn(
        {
          tenantId: points[0]!.tenantId,
          pointCount: points.length,
          error,
        },
        "Failed to persist canonical metric points",
      );
      throw error;
    }
  }

  async upsertSeries(args: MetricDataPointWrite): Promise<void> {
    await this.upsertSeriesMany({
      points: [args.point],
      retentionDays: args.retentionDays,
    });
  }

  async upsertSeriesMany({
    points,
    retentionDays = this.defaultRetentionDays,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      validateMetricPoint({
        point,
        operation: "ClickHouseMetricDataPointAppendRepository.upsertSeriesMany",
      });
    }
    // LastSeenAt is the replacement version, so only the newest point per
    // series can win. Collapsing here writes one row per series instead of one
    // per point and leaves the merge with nothing to undo.
    const latest = new Map<string, CanonicalMetricDataPoint>();
    for (const point of points) {
      const current = latest.get(point.seriesId);
      if (!current || point.timeUnixMs > current.timeUnixMs) {
        latest.set(point.seriesId, point);
      }
    }
    const client = await this.resolveClient(points[0]!.tenantId);
    await client.insert({
      table: "metric_series",
      values: [...latest.values()].map((point) => metricSeriesRow({ point, retentionDays })),
      format: "JSONEachRow",
      clickhouse_settings: INSERT_SETTINGS,
    });
  }

  async recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void> {
    await this.recomputeAffectedRollupsMany({
      points: [args.point],
      retentionDays: args.retentionDays,
    });
  }

  /**
   * Recomputes a chunk's rollups with a fixed number of reads rather than one per point.
   */
  async recomputeAffectedRollupsMany({
    points,
    retentionDays = this.defaultRetentionDays,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    // Projection queues are independent. Ensuring the points here makes the
    // raw-before-derived invariant true even if this projection wins the race.
    await this.ensureDataPoints({ points, retentionDays });

    const bySeries = ClickHouseMetricDataPointAppendRepository.groupBySeries(points);
    const affectedBySeries = ClickHouseMetricDataPointAppendRepository.affectedBucketsBySeries({
      bySeries,
      successorsBySeries: ClickHouseMetricDataPointAppendRepository.groupBySeries(
        await this.successorsOf(points),
      ),
    });

    const authoritative = await this.pointsForAffectedBuckets({
      affectedBySeries,
      tenantId: points[0]!.tenantId,
      retentionDays,
    });

    const rows: MetricRollupRow[] = [];
    for (const [seriesId, affected] of affectedBySeries) {
      rows.push(
        ...buildMetricRollups({
          points: authoritative.get(seriesId) ?? [],
          affectedBuckets: affected,
        }),
      );
    }
    if (rows.length === 0) return;

    const client = await this.resolveClient(points[0]!.tenantId);
    await client.insert({
      table: "metric_time_rollups",
      values: rows.map((row) => metricRollupRow({ row, retentionDays })),
      format: "JSONEachRow",
      clickhouse_settings: INSERT_SETTINGS,
    });
  }

  /**
   * The stored points that can succeed any of `points` within their own series.
   */
  private async successorsOf(points: CanonicalMetricDataPoint[]): Promise<MetricSequencePoint[]> {
    const tenantId = points[0]!.tenantId;
    const client = await this.resolveClient(tenantId);
    const found: MetricSequencePoint[] = [];

    for (const spans of ClickHouseMetricDataPointAppendRepository.successorSeekChunks({
      tenantId,
      spans: ClickHouseMetricDataPointAppendRepository.seriesSpans(points),
    })) {
      const result = await client.query({
        query: ClickHouseMetricDataPointAppendRepository.SUCCESSOR_SEEK_QUERY,
        query_params: ClickHouseMetricDataPointAppendRepository.successorSeekParams({
          tenantId,
          spans,
        }),
        format: "JSONEachRow",
      });
      for (const row of await result.json<SeekMetricRow>()) {
        found.push(metricPointFromSeekRow(row));
      }
    }
    return found;
  }

  /**
   * Every point in the affected buckets, each preceded by the sample the fold differences it
   * against, grouped by series. No read is FINAL: keys are picked from narrow reads, then only
   * the picked rows' payload is read and deduplicated here (T6-F2).
   */
  private async pointsForAffectedBuckets({
    affectedBySeries,
    tenantId,
    retentionDays,
  }: {
    affectedBySeries: ReadonlyMap<string, ReadonlySet<number>>;
    tenantId: string;
    retentionDays: number;
  }): Promise<Map<string, MetricRollupSourcePoint[]>> {
    const seeks = [...affectedBySeries].flatMap(([seriesId, buckets]) =>
      [...buckets].toSorted((a, b) => a - b).map((start) => ({ seriesId, start }) as const),
    );
    const found = new Map<string, MetricRollupSourcePoint[]>();
    if (seeks.length === 0) return found;

    const client = await this.resolveClient(tenantId);
    // A bucket's predecessor may itself sit in an earlier affected bucket, so
    // the ranges overlap by design; the fold needs each point exactly once.
    // Identity is (series, point) because one query spans many series.
    const picked = new Map<string, MetricSequencePoint>();

    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    // A retention window shorter than the near pass would make that pass read
    // past the edge of retention, so the near pass never reaches further than
    // retention does and the far pass has nothing left to cover.
    const nearMs = Math.min(PREDECESSOR_LOOKBACK_MS, retentionMs);

    await this.readBucketRanges({ client, tenantId, seeks, picked, lookbackMs: nearMs });

    const unresolved =
      nearMs >= retentionMs
        ? []
        : seeksWithoutPredecessor({
            seeks,
            points: picked.values(),
            lookbackMs: nearMs,
          });
    if (unresolved.length > 0) {
      await this.readFarPredecessors({
        client,
        tenantId,
        seeks: unresolved,
        picked,
        predecessor: { fromMs: retentionMs, toMs: nearMs },
      });
    }
    if (picked.size === 0) return found;

    for (const point of await this.readPayloads({ client, tenantId, seeks, picked })) {
      const existing = found.get(point.seriesId);
      if (existing) existing.push(point);
      else found.set(point.seriesId, [point]);
    }
    return found;
  }

  /**
   * The near pass: each series' affected buckets as merged key ranges, reading keys only, so the
   * scan never decompresses a payload column; the per-bucket predecessor and bucket rows are
   * picked here. Keys are identical across a row's versions, so no FINAL is needed.
   */
  private async readBucketRanges({
    client,
    tenantId,
    seeks,
    picked,
    lookbackMs,
  }: {
    client: MetricClickHouseClient;
    tenantId: string;
    seeks: readonly BucketSeek[];
    picked: Map<string, MetricSequencePoint>;
    lookbackMs: number;
  }): Promise<void> {
    for (const ranges of ClickHouseMetricDataPointAppendRepository.rangeChunks({
      ranges: bucketReadRanges({ seeks, lookbackMs }),
      paramsOf: (candidate) =>
        ClickHouseMetricDataPointAppendRepository.bucketRangeParams({
          tenantId,
          lookbackMs,
          ranges: candidate,
        }),
    })) {
      const result = await client.query({
        query: ClickHouseMetricDataPointAppendRepository.bucketRangeQuery(ranges.length),
        query_params: ClickHouseMetricDataPointAppendRepository.bucketRangeParams({
          tenantId,
          lookbackMs,
          ranges,
        }),
        format: "JSONEachRow",
      });
      for (const point of pointsForBucketSeeks({
        seeks: seeks.filter((seek) =>
          ranges.some(
            (range) =>
              range.seriesId === seek.seriesId &&
              range.from <= seek.start &&
              seek.start <= range.to,
          ),
        ),
        points: ClickHouseMetricDataPointAppendRepository.distinctKeys(
          await result.json<SeekMetricRow>(),
        ),
        lookbackMs,
      })) {
        picked.set(`${point.seriesId}\u0000${point.pointId}`, point);
      }
    }
  }

  /** One OR'd key-range predicate per range, so the primary key prunes to exactly those ranges. */
  private static bucketRangeQuery(rangeCount: number): string {
    const ranges = Array.from(
      { length: rangeCount },
      (_, index) => `(SeriesId = {series${index}:String}
          AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64} - {lookbackMs:Int64})
          AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({to${index}:Int64} + {bucketMs:Int64}))`,
    );
    return `SELECT ${SEEK_SELECT}
      FROM metric_data_points
      WHERE TenantId = {tenantId:String}
        AND (${ranges.join("\n        OR ")})`;
  }

  private static bucketRangeParams({
    tenantId,
    lookbackMs,
    ranges,
  }: {
    tenantId: string;
    lookbackMs: number;
    ranges: readonly BucketReadRange[];
  }): Record<string, unknown> {
    const params: Record<string, unknown> = {
      tenantId,
      bucketMs: METRIC_ROLLUP_INTERVAL_MS,
      lookbackMs,
    };
    ranges.forEach(({ seriesId, from, to }, index) => {
      params[`series${index}`] = seriesId;
      params[`from${index}`] = from;
      params[`to${index}`] = to;
    });
    return params;
  }

  /** Splits ranges by encoded parameter bytes first, half of {@link SEEKS_PER_QUERY} as the cap. */
  private static rangeChunks<T>({
    ranges,
    paramsOf,
  }: {
    ranges: readonly T[];
    paramsOf: (candidate: readonly T[]) => Record<string, unknown>;
  }): T[][] {
    const chunks: T[][] = [];
    let current: T[] = [];
    for (const range of ranges) {
      const candidate = [...current, range];
      const outgrown =
        candidate.length > Math.floor(SEEKS_PER_QUERY / 2) ||
        ClickHouseMetricDataPointAppendRepository.encodedParamLength(paramsOf(candidate)) >
          SUCCESSOR_PARAM_BUDGET_CHARS;
      if (outgrown && current.length > 0) {
        chunks.push(current);
        current = [range];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  /** A key read without FINAL returns one row per unmerged version; the keys are the same. */
  private static distinctKeys(rows: readonly SeekMetricRow[]): MetricSequencePoint[] {
    const keys = new Map<string, MetricSequencePoint>();
    for (const row of rows)
      keys.set(`${row.SeriesId}\u0000${row.PointId}`, metricPointFromSeekRow(row));
    return [...keys.values()];
  }

  /**
   * The far pass, for buckets with no point in the near lookback: a reverse key seek per bucket,
   * since a range read here could span all of retention. `predecessor` is the half-open window
   * behind each bucket start, as distances so both bounds stay shared scalars.
   */
  private async readFarPredecessors({
    client,
    tenantId,
    seeks,
    picked,
    predecessor,
  }: {
    client: MetricClickHouseClient;
    tenantId: string;
    seeks: readonly BucketSeek[];
    picked: Map<string, MetricSequencePoint>;
    predecessor: { fromMs: number; toMs: number };
  }): Promise<void> {
    for (const chunk of ClickHouseMetricDataPointAppendRepository.chunked(
      seeks,
      Math.floor(SEEKS_PER_QUERY / 2),
    )) {
      const params: Record<string, unknown> = {
        tenantId,
        lookbackFromMs: predecessor.fromMs,
        lookbackToMs: predecessor.toMs,
      };
      const selects = chunk.map(({ seriesId, start }, index) => {
        params[`series${index}`] = seriesId;
        params[`from${index}`] = start;
        return `(SELECT ${SEEK_SELECT}
            FROM metric_data_points
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({from${index}:Int64} - {lookbackToMs:Int64})
              AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64} - {lookbackFromMs:Int64})
            ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`;
      });
      const result = await client.query({
        query: selects.join("\n UNION ALL\n"),
        query_params: params,
        format: "JSONEachRow",
      });
      for (const row of await result.json<SeekMetricRow>()) {
        picked.set(`${row.SeriesId}\u0000${row.PointId}`, metricPointFromSeekRow(row));
      }
    }
  }

  /**
   * The payload of the picked points only, read over each seek's exact window and reduced to the
   * newest version of each, which is what FINAL kept. Rows outside the picked set are dropped, so
   * a point written between the two reads changes nothing.
   */
  private async readPayloads({
    client,
    tenantId,
    seeks,
    picked,
  }: {
    client: MetricClickHouseClient;
    tenantId: string;
    seeks: readonly BucketSeek[];
    picked: ReadonlyMap<string, MetricSequencePoint>;
  }): Promise<MetricRollupSourcePoint[]> {
    const rows: { point: MetricRollupSourcePoint; version: bigint }[] = [];
    for (const windows of ClickHouseMetricDataPointAppendRepository.rangeChunks({
      ranges: payloadWindows({ seeks, picked: picked.values() }),
      paramsOf: (candidate) =>
        ClickHouseMetricDataPointAppendRepository.payloadParams({ tenantId, windows: candidate }),
    })) {
      const result = await client.query({
        query: ClickHouseMetricDataPointAppendRepository.payloadQuery(windows.length),
        query_params: ClickHouseMetricDataPointAppendRepository.payloadParams({
          tenantId,
          windows,
        }),
        format: "JSONEachRow",
      });
      for (const row of await result.json<VersionedRollupSourceRow>()) {
        if (!picked.has(`${row.SeriesId}\u0000${row.PointId}`)) continue;
        rows.push({ point: metricRollupSourceFromRow(row), version: BigInt(row.DedupVersion) });
      }
    }
    return newestVersions({ rows });
  }

  /** Exact `[from, to)` windows; the key predicate prunes, and moves to PREWHERE without FINAL. */
  private static payloadQuery(windowCount: number): string {
    const windows = Array.from(
      { length: windowCount },
      (_, index) => `(SeriesId = {series${index}:String}
          AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64})
          AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({to${index}:Int64}))`,
    );
    return `SELECT ${ROLLUP_SELECT}, DedupVersion
      FROM metric_data_points
      WHERE TenantId = {tenantId:String}
        AND (${windows.join("\n        OR ")})`;
  }

  private static payloadParams({
    tenantId,
    windows,
  }: {
    tenantId: string;
    windows: readonly SeriesWindow[];
  }): Record<string, unknown> {
    const params: Record<string, unknown> = { tenantId };
    windows.forEach(({ seriesId, from, to }, index) => {
      params[`series${index}`] = seriesId;
      params[`from${index}`] = from;
      params[`to${index}`] = to;
    });
    return params;
  }

  /**
   * One fixed statement carries point spans as arrays; successorSeekChunks keeps their encoded
   * URL parameters below SUCCESSOR_PARAM_BUDGET_CHARS. Stored points inside each span cover
   * every successor except the newest one.
   */
  private static readonly SUCCESSOR_SEEK_QUERY = `
    WITH spans AS (
      SELECT
        span.1 AS SpanSeriesId,
        fromUnixTimestamp64Milli(span.2) AS SpanFromTime,
        toUInt64(span.3) AS SpanFromNano,
        span.4 AS SpanFromPoint,
        fromUnixTimestamp64Milli(span.5) AS SpanToTime,
        toUInt64(span.6) AS SpanToNano,
        span.7 AS SpanToPoint
      FROM (
        SELECT arrayJoin(arrayZip(
          {seriesIds:Array(String)},
          {fromTimes:Array(Int64)}, {fromNanos:Array(String)}, {fromPoints:Array(String)},
          {toTimes:Array(Int64)}, {toNanos:Array(String)}, {toPoints:Array(String)}
        )) AS span
      )
    ),
    series_points AS (
      SELECT ${SEEK_SELECT}, metric_data_points.TimeUnixMs AS SeekTime
      FROM metric_data_points
      WHERE TenantId = {tenantId:String}
        AND SeriesId IN {seriesIds:Array(String)}
        AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({scanFrom:Int64})
    )
    SELECT * FROM (
      (SELECT series_points.*
       FROM series_points INNER JOIN spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId
       WHERE series_points.SeekTime <= fromUnixTimestamp64Milli({latestSpanEnd:Int64})
         AND ${ClickHouseMetricDataPointAppendRepository.orderedAfter("From")} AND ${ClickHouseMetricDataPointAppendRepository.orderedBefore("To")})
      UNION ALL
      (SELECT series_points.*
       FROM series_points INNER JOIN spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId
       WHERE series_points.SeekTime >= fromUnixTimestamp64Milli({earliestSpanEnd:Int64})
         AND ${ClickHouseMetricDataPointAppendRepository.orderedAfter("To")}
       ORDER BY series_points.SeriesId ASC, series_points.SeekTime ASC,
         series_points.TimeUnixNano ASC, series_points.PointId ASC
       LIMIT 1 BY SeriesId)
    )
  `;

  /**
   * The table's own row order, (TimeUnixMs, TimeUnixNano, PointId), compared against one end of
   * a joined span. Written out rather than as a tuple comparison so the emitted predicate is
   * the one the per-branch seeks already proved in production.
   */
  private static orderedAfter(bound: "From" | "To"): string {
    return `(series_points.SeekTime > spans.Span${bound}Time
       OR (series_points.SeekTime = spans.Span${bound}Time
         AND (series_points.TimeUnixNano > spans.Span${bound}Nano
           OR (series_points.TimeUnixNano = spans.Span${bound}Nano
             AND series_points.PointId > spans.Span${bound}Point))))`;
  }

  private static orderedBefore(bound: "From" | "To"): string {
    return `(series_points.SeekTime < spans.Span${bound}Time
       OR (series_points.SeekTime = spans.Span${bound}Time
         AND (series_points.TimeUnixNano < spans.Span${bound}Nano
           OR (series_points.TimeUnixNano = spans.Span${bound}Nano
             AND series_points.PointId < spans.Span${bound}Point))))`;
  }

  private static chunked<T>(items: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private static groupBySeries<T extends { seriesId: string }>(
    points: readonly T[],
  ): Map<string, T[]> {
    const bySeries = new Map<string, T[]>();
    for (const point of points) {
      const existing = bySeries.get(point.seriesId);
      if (existing) existing.push(point);
      else bySeries.set(point.seriesId, [point]);
    }
    return bySeries;
  }

  /**
   * Which rollup buckets a chunk moved, per series, decided without another read. A chunk
   * point's true successor is the smallest stored point after it.
   */
  private static affectedBucketsBySeries({
    bySeries,
    successorsBySeries,
  }: {
    bySeries: ReadonlyMap<string, CanonicalMetricDataPoint[]>;
    successorsBySeries: ReadonlyMap<string, MetricSequencePoint[]>;
  }): Map<string, Set<number>> {
    const affectedBySeries = new Map<string, Set<number>>();
    for (const [seriesId, seriesPoints] of bySeries) {
      // Sorted once so each point's successor is a binary search, not a rescan
      // of every candidate — the per-point scan made a single hot series cost
      // O(N²) per chunk. `affectedRollupBuckets` stays the sole owner of the
      // bucket semantics; it just receives the one candidate that can matter.
      const candidates: MetricSequencePoint[] = [
        ...seriesPoints,
        ...(successorsBySeries.get(seriesId) ?? []),
      ].toSorted(comparePoints);
      const affected = ClickHouseMetricDataPointAppendRepository.affectedBucketsForSeries({
        seriesPoints,
        candidates,
      });
      if (affected.size > 0) affectedBySeries.set(seriesId, affected);
    }
    return affectedBySeries;
  }

  private static affectedBucketsForSeries({
    seriesPoints,
    candidates,
  }: {
    seriesPoints: readonly CanonicalMetricDataPoint[];
    candidates: readonly MetricSequencePoint[];
  }): Set<number> {
    const affected = new Set<number>();
    for (const point of seriesPoints) {
      const successor = ClickHouseMetricDataPointAppendRepository.successorIn({
        sorted: candidates,
        point,
      });
      for (const bucket of affectedRollupBuckets({
        points: successor ? [successor] : [],
        insertedPoint: point,
      })) {
        affected.add(bucket);
      }
    }
    return affected;
  }

  private static seriesSpans(points: readonly CanonicalMetricDataPoint[]): SeriesSpan[] {
    return [...ClickHouseMetricDataPointAppendRepository.groupBySeries(points)].map(
      ([seriesId, seriesPoints]) => {
        const sorted = [...seriesPoints].toSorted(comparePoints);
        return {
          seriesId,
          first: sorted[0]!,
          last: sorted[sorted.length - 1]!,
        };
      },
    );
  }

  /**
   * Eleven parameters, whatever the chunk holds - seven of them arrays the server zips back
   * into one row per series.
   */
  private static successorSeekParams({
    tenantId,
    spans,
  }: {
    tenantId: string;
    spans: readonly SeriesSpan[];
  }): Record<string, unknown> {
    return {
      tenantId,
      seriesIds: spans.map((span) => span.seriesId),
      fromTimes: spans.map((span) => span.first.timeUnixMs),
      fromNanos: spans.map((span) => span.first.timeUnixNano),
      fromPoints: spans.map((span) => span.first.pointId),
      toTimes: spans.map((span) => span.last.timeUnixMs),
      toNanos: spans.map((span) => span.last.timeUnixNano),
      toPoints: spans.map((span) => span.last.pointId),
      scanFrom: Math.min(...spans.map((span) => span.first.timeUnixMs)),
      earliestSpanEnd: Math.min(...spans.map((span) => span.last.timeUnixMs)),
      latestSpanEnd: Math.max(...spans.map((span) => span.last.timeUnixMs)),
    };
  }

  /**
   * `@clickhouse/client`'s `formatQueryParams` for the value shapes this file binds - strings,
   * numbers, and arrays of either. Mirrored rather than imported because the client exports it
   * only from a path inside its `dist` tree.
   */
  private static formatParamValue({
    value,
    isInArray = false,
  }: {
    value: unknown;
    isInArray?: boolean;
  }): string {
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
      const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\t/g, "\\t")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
      return isInArray ? `'${escaped}'` : escaped;
    }
    if (Array.isArray(value)) {
      return `[${value
        .map((element) =>
          ClickHouseMetricDataPointAppendRepository.formatParamValue({
            value: element,
            isInArray: true,
          }),
        )
        .join(",")}]`;
    }
    throw new Error(
      `Unsupported successor-seek parameter shape: ${typeof value}. Only strings, numbers and arrays of them are measurable against the request budget.`,
    );
  }

  /** How long a request's `param_*` entries encode to, in URL characters. */
  private static encodedParamLength(params: Record<string, unknown>): number {
    return new URLSearchParams(
      Object.entries(params).map(([name, value]): [string, string] => [
        `param_${name}`,
        ClickHouseMetricDataPointAppendRepository.formatParamValue({ value }),
      ]),
    ).toString().length;
  }

  /**
   * Where the successor read splits: encoded parameter bytes first, {@link SEEKS_PER_QUERY}
   * series as the upper cap. Series count is the wrong quantity to bound a request by.
   */
  private static successorSeekChunks({
    tenantId,
    spans,
  }: {
    tenantId: string;
    spans: readonly SeriesSpan[];
  }): SeriesSpan[][] {
    const chunks: SeriesSpan[][] = [];
    let current: SeriesSpan[] = [];
    for (const span of spans) {
      const candidate = [...current, span];
      const outgrown =
        candidate.length > SEEKS_PER_QUERY ||
        ClickHouseMetricDataPointAppendRepository.encodedParamLength(
          ClickHouseMetricDataPointAppendRepository.successorSeekParams({
            tenantId,
            spans: candidate,
          }),
        ) > SUCCESSOR_PARAM_BUDGET_CHARS;
      if (outgrown && current.length > 0) {
        chunks.push(current);
        current = [span];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  /** The first point ordering strictly after `point`, from a sorted array. */
  private static successorIn({
    sorted,
    point,
  }: {
    sorted: readonly MetricSequencePoint[];
    point: MetricSequencePoint;
  }): MetricSequencePoint | undefined {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (comparePoints(sorted[mid]!, point) > 0) hi = mid;
      else lo = mid + 1;
    }
    return sorted[lo];
  }
}
