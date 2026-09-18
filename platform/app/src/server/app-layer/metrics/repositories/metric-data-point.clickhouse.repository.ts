import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  affectedRollupBuckets,
  buildMetricRollups,
} from "~/server/event-sourcing/pipelines/metric-processing/rollup";
import {
  comparePoints,
  type MetricSequencePoint,
} from "~/server/event-sourcing/pipelines/metric-processing/rollup/sequence";
import { METRIC_ROLLUP_INTERVAL_MS } from "~/server/event-sourcing/pipelines/metric-processing/schemas/constants";
import type {
  CanonicalMetricDataPoint,
  MetricRollupRow,
  MetricUsageEstimate,
  MetricUsageEstimateQuery,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import type {
  MetricDataPointBulkWrite,
  MetricDataPointRepository,
  MetricDataPointWrite,
  SeriesTotalByPointAttribute,
} from "./metric-data-point.repository";
import {
  AUTHORITATIVE_SELECT,
  fromRaw,
  fromSeekRow,
  type RawMetricRow,
  rawRow,
  rollupRow,
  SEEK_SELECT,
  type SeekMetricRow,
  seriesRow,
  usageEstimateRow,
  validatePoint,
} from "./metric-data-point.rows";
import { queryMetricUsageEstimates } from "./metric-data-point.usage";

const logger = createLogger(
  "langwatch:app-layer:metrics:metric-data-point-repository",
);

const INSERT_SETTINGS = { async_insert: 1, wait_for_async_insert: 1 } as const;

/**
 * The upper cap on what one rollup query folds together: series per set of
 * array parameters for the successor read, and — halved — buckets per request
 * for the affected-bucket read. No statement grows with either number any more,
 * so this bounds how much one request may *read*, not how large it may be.
 *
 * Size is bounded separately, and first, by {@link SUCCESSOR_PARAM_BUDGET_CHARS}:
 * the successor read splits as soon as the encoded parameters would outgrow
 * that budget, which on this table's 64-character identifiers happens well
 * before 64 series. Raising this number therefore widens a read; it cannot make
 * a request larger than the byte budget allows.
 */
const SEEKS_PER_QUERY = 64;

/**
 * The ceiling one successor request's encoded `param_*` entries must stay
 * under, measured the way `@clickhouse/client` measures it: `formatQueryParams`
 * per value, then `new URLSearchParams(entries).toString().length`.
 *
 * The client has a threshold of its own, `MAX_URL_BIND_PARAM_LENGTH` = 4096,
 * above which it can route parameters through a multipart body instead of the
 * URL — but only when `use_multipart_params_auto` is on, and nothing here turns
 * it on, so `param_*` entries ride the URL at any length. This budget therefore
 * has to hold on its own, and it sits below the client's with enough headroom
 * that a longer identifier or an added scalar cannot cross the client's ceiling
 * without crossing this one first.
 */
const SUCCESSOR_PARAM_BUDGET_CHARS = 3500;

/**
 * The successor read's whole statement, emitted once at module load rather than
 * rebuilt per chunk, because nothing in it varies with the chunk any more.
 *
 * Every per-point value now travels as an array parameter, so the statement is
 * a fixed ~2.4 KB and the request binds eleven `param_*` entries whatever the
 * chunk holds. The shape this replaced grew four parameters and a full branch
 * per point: at {@link SEEKS_PER_QUERY} that is 256 parameters and tens of
 * kilobytes.
 *
 * A fixed statement is not on its own a bound on the request. The arrays' own
 * contents still grow with the number of series, and they ride the URL as
 * `param_*` entries, so {@link successorSeekChunks} splits on the encoded bytes
 * those arrays produce ({@link SUCCESSOR_PARAM_BUDGET_CHARS}) rather than on a
 * series count. Bounding the quantity that actually travels is the point; a
 * smaller-but-still-unbounded request would only move the day it is crossed
 * again.
 *
 * Two branches, and the split is what keeps the reads bounded. Every point in
 * the chunk is already stored when this runs, so within one series the
 * successor of every chunk point except the newest must land at or before the
 * next chunk point - it cannot be further away than a row we know is there.
 * Only the newest chunk point in a series needs an open-ended look forward.
 * So the first branch reads the chunk's own span, and the second is a single
 * `LIMIT 1 BY SeriesId` seek past the end of it. `affectedBucketsBySeries`
 * takes the minimum of the union, so returning the whole span rather than one
 * row per point cannot change which successor a point resolves to.
 *
 * SEEK_SELECT appears exactly once, in the `series_points` CTE, and that CTE
 * carries the tenant, series and lower-bound predicates itself - TenantId
 * first, matching the table's sort key - so the branches add only the
 * comparisons that need the joined span. Correctness therefore does not depend
 * on predicate pushdown; the CTE is already the seek.
 *
 * Written once, executed twice: ClickHouse substitutes a non-recursive `WITH`
 * at each reference, and both union operands reference `series_points`, so the
 * FINAL scan over `metric_data_points` runs once per branch. One scan under a
 * single `WHERE (span-interior OR past-span)` would halve that, at the cost of
 * the `LIMIT 1 BY` no longer applying per operand - which is exactly what keeps
 * the look forward to one row per series. Measure before trading.
 *
 * Each branch does add the one constant bound its own half can prove, because
 * a bound reached only through the join cannot prune partitions and
 * `metric_data_points` partitions by `toYearWeek(TimeUnixMs)`. A span row sits
 * below its series' far end, so it sits below `latestSpanEnd`, the furthest of
 * them; a row past the far end sits above `earliestSpanEnd`, the nearest. Both
 * are pure upside: pushed down they prune, left in place they are a cheap
 * filter over rows the branch discards anyway. Range-filtering TimeUnixMs under FINAL is
 * safe here because it is part of the dedup key - a different TimeUnixMs is a
 * different row, never a later version of this one, so no version can drift
 * out of the window (the movable-column trap in
 * dev/docs/best_practices/clickhouse-queries.md).
 *
 * The `LIMIT 1 BY` is the narrow kind that doc permits, not the kind it bans:
 * the branch selects the six sequence columns and nothing heavy, so a granule
 * costs nothing to materialise. Do not let it grow a payload, attribute or
 * bucket column - at that point it becomes the anti-pattern and wants the
 * IN-tuple form instead.
 *
 * What those three bounds do NOT do is bound the read per series. All three are
 * chunk-global: one backfilled point in one series lowers `scanFrom` for every
 * series in the request, and the branch that looks past a span end is
 * `[earliestSpanEnd, ∞)` per series under FINAL, terminating only on the
 * `LIMIT 1 BY` rather than on an index range. So a chunk that pairs one late
 * series with live ones reads more than the live ones needed, and the wider the
 * chunk the more series pay for it. A per-series bounded lookahead - a join-side
 * `SpanToTime + <window>` upper bound, with a fallback seek for the series the
 * bounded branch returns nothing for - would fix both halves. It is left to its
 * own change deliberately: it needs `EXPLAIN indexes=1` against a real server
 * and equivalence coverage the parameter-level model in the unit tests cannot
 * give it, and getting it wrong loses successors rather than costing time.
 */
const SUCCESSOR_SEEK_QUERY = `
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
       AND ${orderedAfter("From")} AND ${orderedBefore("To")})
    UNION ALL
    (SELECT series_points.*
     FROM series_points INNER JOIN spans ON CAST(series_points.SeriesId AS String) = spans.SpanSeriesId
     WHERE series_points.SeekTime >= fromUnixTimestamp64Milli({earliestSpanEnd:Int64})
       AND ${orderedAfter("To")}
     ORDER BY series_points.SeriesId ASC, series_points.SeekTime ASC,
       series_points.TimeUnixNano ASC, series_points.PointId ASC
     LIMIT 1 BY SeriesId)
  )
`;

/**
 * The table's own row order, (TimeUnixMs, TimeUnixNano, PointId), compared
 * against one end of a joined span. Written out rather than as a tuple
 * comparison so the emitted predicate is the one the per-branch seeks already
 * proved in production.
 *
 * It reads `series_points.SeekTime` and never `TimeUnixMs`, which is why the
 * CTE keeps the raw `DateTime64` under that second name: SEEK_SELECT already
 * binds `TimeUnixMs` to its epoch-milli alias, so a comparison written against
 * that name would compare against the alias instead of the column. Do not
 * "simplify" `SeekTime` away.
 */
function orderedAfter(bound: "From" | "To"): string {
  return `(series_points.SeekTime > spans.Span${bound}Time
     OR (series_points.SeekTime = spans.Span${bound}Time
       AND (series_points.TimeUnixNano > spans.Span${bound}Nano
         OR (series_points.TimeUnixNano = spans.Span${bound}Nano
           AND series_points.PointId > spans.Span${bound}Point))))`;
}

function orderedBefore(bound: "From" | "To"): string {
  return `(series_points.SeekTime < spans.Span${bound}Time
     OR (series_points.SeekTime = spans.Span${bound}Time
       AND (series_points.TimeUnixNano < spans.Span${bound}Nano
         OR (series_points.TimeUnixNano = spans.Span${bound}Nano
           AND series_points.PointId < spans.Span${bound}Point))))`;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function groupBySeries<T extends { seriesId: string }>(
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
 * Which rollup buckets a chunk moved, per series, decided without another read.
 *
 * A chunk point's true successor is the smallest stored point after it. Every
 * chunk point is already stored by the time this runs, and the seek returned
 * the smallest stored point after each one, so the true successor is somewhere
 * in the union of the two and no stored point can sit between them. Taking the
 * minimum of that union — which is all `affectedRollupBuckets` does — therefore
 * lands on exactly the row a per-point neighbour query would have returned,
 * whatever order the chunk arrived in.
 */
function affectedBucketsBySeries({
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
    const affected = affectedBucketsForSeries({ seriesPoints, candidates });
    if (affected.size > 0) affectedBySeries.set(seriesId, affected);
  }
  return affectedBySeries;
}

function affectedBucketsForSeries({
  seriesPoints,
  candidates,
}: {
  seriesPoints: readonly CanonicalMetricDataPoint[];
  candidates: readonly MetricSequencePoint[];
}): Set<number> {
  const affected = new Set<number>();
  for (const point of seriesPoints) {
    const successor = successorIn({ sorted: candidates, point });
    for (const bucket of affectedRollupBuckets({
      points: successor ? [successor] : [],
      insertedPoint: point,
    })) {
      affected.add(bucket);
    }
  }
  return affected;
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

function seriesSpans(
  points: readonly CanonicalMetricDataPoint[],
): SeriesSpan[] {
  return [...groupBySeries(points)].map(([seriesId, seriesPoints]) => {
    const sorted = [...seriesPoints].sort(comparePoints);
    return {
      seriesId,
      first: sorted[0]!,
      last: sorted[sorted.length - 1]!,
    };
  });
}

/**
 * Eleven parameters, whatever the chunk holds - seven of them arrays the server
 * zips back into one row per series.
 *
 * Three are the constant time bounds the statement prunes partitions with, and
 * they are the widest each scope can prove: `scanFrom` the earliest span start
 * for the shared CTE, `latestSpanEnd` for the branch that reads within the
 * spans, `earliestSpanEnd` for the branch that reads past them. The last two
 * are both derived from span *ends* - the earliest span start is `scanFrom` -
 * so widening either to a span start is a change of meaning, not a typo fix.
 * Nanosecond values travel as strings because they exceed what a JSON number
 * carries exactly; the statement casts them back with `toUInt64`.
 */
function successorSeekParams({
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
 * `@clickhouse/client`'s `formatQueryParams` for the value shapes this file
 * binds - strings, numbers, and arrays of either. Mirrored rather than imported
 * because the client exports it only from a path inside its `dist` tree.
 *
 * The unit test re-measures every request this chunker emits with the client's
 * own `formatQueryParams`, so a divergence that made this under-measure fails
 * there rather than silently shipping an oversized request. Over-measuring only
 * costs a smaller chunk.
 */
function formatParamValue({
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
      .map((element) => formatParamValue({ value: element, isInArray: true }))
      .join(",")}]`;
  }
  throw new Error(
    `Unsupported successor-seek parameter shape: ${typeof value}. Only strings, numbers and arrays of them are measurable against the request budget.`,
  );
}

/** How long a request's `param_*` entries encode to, in URL characters. */
function encodedParamLength(params: Record<string, unknown>): number {
  return new URLSearchParams(
    Object.entries(params).map(([name, value]): [string, string] => [
      `param_${name}`,
      formatParamValue({ value }),
    ]),
  ).toString().length;
}

/**
 * Where the successor read splits: encoded parameter bytes first,
 * {@link SEEKS_PER_QUERY} series as the upper cap.
 *
 * Series count is the wrong quantity to bound a request by. A series
 * contributes seven values, three of them 64-character identifiers, so what
 * fits in one request depends on the identifiers rather than on the count -
 * which is how a shape that looked bounded at 64 series produced a request
 * larger than the per-point shape it replaced. Measuring what actually travels
 * keeps the request bounded whatever the batch holds.
 *
 * A single series whose own parameters exceed the budget is still sent alone:
 * correctness first, and this table's identifier widths cannot reach that.
 */
function successorSeekChunks({
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
      encodedParamLength(successorSeekParams({ tenantId, spans: candidate })) >
        SUCCESSOR_PARAM_BUDGET_CHARS;
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
function successorIn({
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

export class MetricDataPointClickHouseRepository
  implements MetricDataPointRepository
{
  /**
   * Both resolvers are required on purpose. The organization-wide usage query
   * relies on its client being resolved from the organization — that is what
   * makes `OrganizationId` a real isolation boundary rather than a convention
   * (see the carve-out in dev/docs/best_practices/clickhouse-queries.md).
   * Defaulting this to the project resolver would hand it an organization id
   * to look up as a project.
   */
  private readonly resolveClient: ClickHouseClientResolver;
  private readonly resolveOrganizationClient: ClickHouseClientResolver;

  constructor({
    resolveClient,
    resolveOrganizationClient,
  }: {
    resolveClient: ClickHouseClientResolver;
    resolveOrganizationClient: ClickHouseClientResolver;
  }) {
    this.resolveClient = resolveClient;
    this.resolveOrganizationClient = resolveOrganizationClient;
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
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      validatePoint({
        point,
        operation: "MetricDataPointClickHouseRepository.ensureDataPoints",
      });
    }
    const client = await this.resolveClient(points[0]!.tenantId);
    try {
      // Raw must be authoritative before any derived or shadow write.
      await client.insert({
        table: "metric_data_points",
        values: points.map((point) => rawRow({ point, retentionDays })),
        format: "JSONEachRow",
        clickhouse_settings: INSERT_SETTINGS,
      });
      await client.insert({
        table: "metric_usage_estimates",
        values: points.map(usageEstimateRow),
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
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    for (const point of points) {
      validatePoint({
        point,
        operation: "MetricDataPointClickHouseRepository.upsertSeriesMany",
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
        seriesRow({ point, retentionDays }),
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
   * Recomputes a chunk's rollups with a fixed number of reads rather than one
   * per point. Both reads a rollup needs — the successor that decides which
   * buckets moved, and the authoritative points inside them — are index seeks,
   * so the round trip, not the scan, is what a chunk pays for. Folding every
   * seek in the chunk into a handful of statements makes the cost track the
   * number of affected buckets instead of the number of points.
   *
   * Ensuring the raw points up front also makes the result independent of the
   * order the chunk happens to arrive in: every decision below is taken
   * against stored rows, never against the chunk's own sequence.
   */
  async recomputeAffectedRollupsMany({
    points,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    // Projection queues are independent. Ensuring the points here makes the
    // raw-before-derived invariant true even if this projection wins the race.
    await this.ensureDataPoints({ points, retentionDays });

    const bySeries = groupBySeries(points);
    const affectedBySeries = affectedBucketsBySeries({
      bySeries,
      successorsBySeries: groupBySeries(await this.successorsOf(points)),
    });

    const authoritative = await this.pointsForAffectedBuckets({
      affectedBySeries,
      tenantId: points[0]!.tenantId,
      organizationId: points[0]!.organizationId,
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
      values: rows.map((row) => rollupRow({ row, retentionDays })),
      format: "JSONEachRow",
      clickhouse_settings: INSERT_SETTINGS,
    });
  }

  async queryUsageEstimates(
    query: MetricUsageEstimateQuery,
  ): Promise<MetricUsageEstimate[]> {
    if (!query.organizationId) {
      throw new SecurityError(
        "MetricDataPointClickHouseRepository.queryUsageEstimates",
        "organizationId is required",
      );
    }
    const client = query.tenantId
      ? await this.resolveClient(query.tenantId)
      : await this.resolveOrganizationClient(query.organizationId);
    return await queryMetricUsageEstimates({ client, query });
  }

  async getSeriesTotalsByPointAttribute({
    tenantId,
    attributeKey,
    attributeValue,
    fromMs,
  }: {
    tenantId: string;
    attributeKey: string;
    attributeValue: string;
    fromMs: number;
  }): Promise<SeriesTotalByPointAttribute[]> {
    if (!tenantId) {
      throw new SecurityError(
        "MetricDataPointClickHouseRepository.getSeriesTotalsByPointAttribute",
        "tenantId is required",
      );
    }
    const client = await this.resolveClient(tenantId);
    // Two hops in one query: the series catalog names the label-matched
    // SeriesIds (deduped with argMax per the catalog's documented
    // partition/dedup mismatch — its reader must never rely on the engine
    // having merged), then the rollups, whose buckets are delta-converged,
    // sum to the series total. `has(PointAttributeKeys, ...)` gates the JSON
    // extraction to rows that can match at all.
    const result = await client.query({
      query: `
        WITH matched AS (
          SELECT
            SeriesId,
            argMax(MetricName, LastSeenAt) AS MetricName,
            argMax(PointAttributesJson, LastSeenAt) AS PointAttributesJson
          FROM metric_series
          WHERE TenantId = {tenantId:String}
            AND has(PointAttributeKeys, {attributeKey:String})
            AND JSONExtractString(PointAttributesJson, {attributeKey:String}) = {attributeValue:String}
          GROUP BY SeriesId
        )
        SELECT
          matched.MetricName AS MetricName,
          matched.PointAttributesJson AS PointAttributesJson,
          sum(coalesce(rollups.Sum, 0)) AS Total
        FROM metric_time_rollups AS rollups
        INNER JOIN matched ON rollups.SeriesId = matched.SeriesId
        WHERE rollups.TenantId = {tenantId:String}
          AND rollups.BucketStart >= {fromMs:DateTime64(3)}
        GROUP BY matched.SeriesId, matched.MetricName, matched.PointAttributesJson
      `,
      query_params: {
        tenantId,
        attributeKey,
        attributeValue,
        fromMs: new Date(fromMs),
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      MetricName: string;
      PointAttributesJson: string;
      Total: number | string;
    }>();
    return rows.map((row) => {
      // Stored by our own write path, but one malformed row must degrade to
      // an attribute-less point rather than throw away the whole read.
      let pointAttributes: Record<string, string> = {};
      try {
        pointAttributes = JSON.parse(row.PointAttributesJson) as Record<
          string,
          string
        >;
      } catch {
        pointAttributes = {};
      }
      return {
        metricName: row.MetricName,
        total: Number(row.Total),
        pointAttributes,
      };
    });
  }

  /**
   * The stored points that can succeed any of `points` within their own series.
   * A successor is the only neighbour able to pull a second bucket into the
   * affected set, so it is the only one worth a read — an earlier revision also
   * fetched each point's predecessor and then discarded it.
   *
   * The statement is {@link SUCCESSOR_SEEK_QUERY}, which does not vary with the
   * chunk. What chunking bounds is the request: {@link successorSeekChunks}
   * splits the series so the encoded parameters stay inside
   * {@link SUCCESSOR_PARAM_BUDGET_CHARS}, since the statement travels in the
   * body but the parameters travel in the URL.
   *
   * The read stays payload-free (SEEK_SELECT, never the full row): running
   * FINAL over a series while materialising the megabyte-scale payload column
   * is what pushed one query past the server's per-query memory cap
   * (MEMORY_LIMIT_EXCEEDED in ReplacingSorted). The seek only exists to order
   * points and locate buckets.
   */
  private async successorsOf(
    points: CanonicalMetricDataPoint[],
  ): Promise<MetricSequencePoint[]> {
    const tenantId = points[0]!.tenantId;
    const client = await this.resolveClient(tenantId);
    const found: MetricSequencePoint[] = [];

    for (const spans of successorSeekChunks({
      tenantId,
      spans: seriesSpans(points),
    })) {
      const result = await client.query({
        query: SUCCESSOR_SEEK_QUERY,
        query_params: successorSeekParams({ tenantId, spans }),
        format: "JSONEachRow",
      });
      for (const row of await result.json<SeekMetricRow>()) {
        found.push(fromSeekRow(row));
      }
    }
    return found;
  }

  /**
   * Every point in the affected buckets, each preceded by the sample the fold
   * differences it against, grouped by series. Buckets are fetched as their own
   * narrow ranges rather than one span: a late point and a distant next sample
   * would otherwise scan every partition between them only to discard the rows.
   *
   * The predecessor seek is bounded below by the series' retention window: a
   * predecessor older than that is expired (or about to be), and the fold
   * already treats an absent predecessor as a reset/gap. Without the bound a
   * sparse series pays a reverse scan across every partition — including
   * S3-tiered cold storage — hunting for a row that no longer matters.
   */
  private async pointsForAffectedBuckets({
    affectedBySeries,
    tenantId,
    organizationId,
    retentionDays,
  }: {
    affectedBySeries: ReadonlyMap<string, ReadonlySet<number>>;
    tenantId: string;
    organizationId: string;
    retentionDays: number;
  }): Promise<Map<string, CanonicalMetricDataPoint[]>> {
    const seeks = [...affectedBySeries].flatMap(([seriesId, buckets]) =>
      [...buckets]
        .sort((a, b) => a - b)
        .map((start) => ({ seriesId, start }) as const),
    );
    const found = new Map<string, CanonicalMetricDataPoint[]>();
    if (seeks.length === 0) return found;

    const client = await this.resolveClient(tenantId);
    // A bucket's predecessor may itself sit in an earlier affected bucket, so
    // the ranges overlap by design; the fold needs each point exactly once.
    // Identity is (series, point) because one query now spans many series, and
    // a point id is only ever unique within its own.
    const unique = new Map<string, CanonicalMetricDataPoint>();

    // Half the cap, and the divisor is a size bound rather than a
    // statement-count one: the successor read emits one statement whatever its
    // chunk holds, so there is no statement ceiling left here to match. What
    // there is: this read binds two parameters per bucket, one of them a
    // 64-character series identifier, so 32 buckets encode to roughly 3.5k
    // characters of `param_*` entries - inside the client's own 4096-character
    // ceiling on them, where 64 buckets would be half as far outside it again.
    for (const chunk of chunked(seeks, Math.floor(SEEKS_PER_QUERY / 2))) {
      // Two shared scalars replace the per-seek end and cutoff bounds: both
      // were derived from the bucket start, so the server can derive them too
      // and the parameter fan-out halves without the statement changing shape.
      const params: Record<string, unknown> = {
        tenantId,
        bucketMs: METRIC_ROLLUP_INTERVAL_MS,
        retentionMs: retentionDays * 24 * 60 * 60 * 1000,
      };
      const selects = chunk.flatMap(({ seriesId, start }, index) => {
        params[`series${index}`] = seriesId;
        params[`from${index}`] = start;
        // Both branches keep a seek per bucket rather than folding into one
        // joined statement the way the successor read does. The predecessor
        // branch is why: its lower bound is the retention window, and a join
        // can only apply a per-seek bound after the rows are read, so the
        // single-row reverse index seek would become a read of every point in
        // the series across that whole window — the memory class #6493 fixed.
        // The successor read folds safely because every bound there is the
        // chunk's own span. AUTHORITATIVE_SELECT is everything the fold reads
        // without the payload column, which is what made these FINAL reads
        // memory-heavy.
        return [
          `(SELECT ${AUTHORITATIVE_SELECT}
            FROM metric_data_points FINAL
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs < fromUnixTimestamp64Milli({from${index}:Int64})
              AND metric_data_points.TimeUnixMs >= fromUnixTimestamp64Milli({from${index}:Int64} - {retentionMs:Int64})
            ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`,
          `(SELECT ${AUTHORITATIVE_SELECT}
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
      for (const row of await result.json<
        Omit<RawMetricRow, "CanonicalPayload">
      >()) {
        unique.set(
          `${row.SeriesId}\u0000${row.PointId}`,
          fromRaw({ row, organizationId }),
        );
      }
    }

    for (const point of unique.values()) {
      const existing = found.get(point.seriesId);
      if (existing) existing.push(point);
      else found.set(point.seriesId, [point]);
    }
    return found;
  }
}
