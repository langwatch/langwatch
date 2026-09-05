import type { ClickHouseSettings, DataFormat } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { affectedRollupBuckets, buildMetricRollups } from "@langwatch/metric-contract";
import {
  comparePoints,
  type MetricRollupSourcePoint,
  type MetricSequencePoint,
} from "@langwatch/metric-contract";
import { METRIC_ROLLUP_INTERVAL_MS } from "@langwatch/metric-contract";
import type { CanonicalMetricDataPoint, MetricRollupRow } from "@langwatch/metric-contract";
import {
  MetricDataPointAppendRepository,
  type MetricDataPointBulkWrite,
  type MetricDataPointWrite,
} from "../metric-data-point-append.repository";
import {
  MetricDataPointMapper,
  ROLLUP_SELECT,
  type RollupSourceRow,
  SEEK_SELECT,
  type SeekMetricRow,
} from "./clickhouse.metric-data-point.mapper";

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
    unscoped?: { reason: string };
  }): Promise<{ json<T = unknown>(): Promise<T[]> }>;
}

export type MetricClickHouseClientResolver = (tenantId: string) => Promise<MetricClickHouseClient>;
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

/**
 * The seeks whose predecessor the near pass failed to find.
 */
function seeksWithoutPredecessor({
  seeks,
  points,
  lookbackMs,
}: {
  seeks: readonly { seriesId: string; start: number }[];
  points: Iterable<MetricRollupSourcePoint>;
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
      MetricDataPointMapper.validatePoint({
        point,
        operation: "ClickHouseMetricDataPointAppendRepository.ensureDataPoints",
      });
    }
    const client = await this.resolveClient(points[0]!.tenantId);
    try {
      // Raw must be authoritative before any derived or shadow write.
      await client.insert({
        table: "metric_data_points",
        values: points.map((point) => MetricDataPointMapper.rawRow({ point, retentionDays })),
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
      await client.insert({
        table: "metric_usage_estimates",
        values: points.map((point) => MetricDataPointMapper.usageEstimateRow(point)),
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
      MetricDataPointMapper.validatePoint({
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
      values: [...latest.values()].map((point) =>
        MetricDataPointMapper.seriesRow({ point, retentionDays }),
      ),
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
      values: rows.map((row) => MetricDataPointMapper.rollupRow({ row, retentionDays })),
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
        found.push(MetricDataPointMapper.fromSeekRow(row));
      }
    }
    return found;
  }

  /**
   * Every point in the affected buckets, each preceded by the sample the fold differences it
   * against, grouped by series.
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
      [...buckets].sort((a, b) => a - b).map((start) => ({ seriesId, start }) as const),
    );
    const found = new Map<string, MetricRollupSourcePoint[]>();
    if (seeks.length === 0) return found;

    const client = await this.resolveClient(tenantId);
    // A bucket's predecessor may itself sit in an earlier affected bucket, so
    // the ranges overlap by design; the fold needs each point exactly once.
    // Identity is (series, point) because one query now spans many series, and
    // a point id is only ever unique within its own.
    const unique = new Map<string, MetricRollupSourcePoint>();

    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    // A retention window shorter than the near pass would make that pass read
    // past the edge of retention, so the near pass never reaches further than
    // retention does and the far pass has nothing left to cover.
    const nearMs = Math.min(PREDECESSOR_LOOKBACK_MS, retentionMs);

    await this.readAffectedBuckets({
      client,
      tenantId,
      seeks,
      unique,
      predecessor: { fromMs: nearMs, toMs: 0 },
      shouldReadBucketRows: true,
    });

    const unresolved =
      nearMs >= retentionMs
        ? []
        : seeksWithoutPredecessor({
            seeks,
            points: unique.values(),
            lookbackMs: nearMs,
          });
    if (unresolved.length > 0) {
      await this.readAffectedBuckets({
        client,
        tenantId,
        seeks: unresolved,
        unique,
        predecessor: { fromMs: retentionMs, toMs: nearMs },
        shouldReadBucketRows: false,
      });
    }

    for (const point of unique.values()) {
      const existing = found.get(point.seriesId);
      if (existing) existing.push(point);
      else found.set(point.seriesId, [point]);
    }
    return found;
  }

  /**
   * One pass of the affected-bucket read, collecting into `unique`. `predecessor` is the
   * half-open window behind each bucket start the reverse seek may look in, as distances rather
   * than instants so both bounds stay shared scalars however many buckets the chunk holds.
   */
  private async readAffectedBuckets({
    client,
    tenantId,
    seeks,
    unique,
    predecessor,
    shouldReadBucketRows,
  }: {
    client: MetricClickHouseClient;
    tenantId: string;
    seeks: readonly { seriesId: string; start: number }[];
    unique: Map<string, MetricRollupSourcePoint>;
    predecessor: { fromMs: number; toMs: number };
    shouldReadBucketRows: boolean;
  }): Promise<void> {
    // Half the cap, and the divisor is a size bound rather than a statement-count one: the
    // successor read emits one statement whatever its chunk holds, so there is no statement
    // ceiling left here to match.
    for (const chunk of ClickHouseMetricDataPointAppendRepository.chunked(
      seeks,
      Math.floor(SEEKS_PER_QUERY / 2),
    )) {
      // Shared scalars replace the per-seek end and cutoff bounds: all were
      // derived from the bucket start, so the server can derive them too and
      // the parameter fan-out stays at two per bucket whatever the chunk holds.
      const params: Record<string, unknown> = {
        tenantId,
        bucketMs: METRIC_ROLLUP_INTERVAL_MS,
        lookbackFromMs: predecessor.fromMs,
        lookbackToMs: predecessor.toMs,
      };
      const selects = chunk.flatMap(({ seriesId, start }, index) => {
        params[`series${index}`] = seriesId;
        params[`from${index}`] = start;
        // Both branches keep a seek per bucket rather than folding into one joined statement
        // the way the successor read does. The predecessor branch is why: its bounds are
        // per-seek, and a join can only apply those after the rows are read, so the single-row
        // reverse index seek would become a read of every point in the series across the whole
        // window - the memory class #6493 fixed.
        const predecessorSeek = `(SELECT ${ROLLUP_SELECT}
            FROM metric_data_points FINAL
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({from${index}:Int64} - {lookbackToMs:Int64})
              AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64} - {lookbackFromMs:Int64})
            ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`;
        if (!shouldReadBucketRows) return [predecessorSeek];
        return [
          predecessorSeek,
          `(SELECT ${ROLLUP_SELECT}
            FROM metric_data_points FINAL
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64})
              AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({from${index}:Int64} + {bucketMs:Int64})
            ORDER BY metric_data_points.TimeUnixMs ASC, TimeUnixNano ASC, PointId ASC)`,
        ];
      });
      const result = await client.query({
        query: selects.join("\n UNION ALL\n"),
        query_params: params,
        format: "JSONEachRow",
      });
      for (const row of await result.json<RollupSourceRow>()) {
        unique.set(`${row.SeriesId}\u0000${row.PointId}`, MetricDataPointMapper.fromRollupRow(row));
      }
    }
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
      FROM metric_data_points FINAL
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
      ].sort(comparePoints);
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
        const sorted = [...seriesPoints].sort(comparePoints);
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
