import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  affectedRollupBuckets,
  buildMetricRollups,
} from "~/server/event-sourcing/pipelines/metric-processing/rollup";
import { comparePoints } from "~/server/event-sourcing/pipelines/metric-processing/rollup/sequence";
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
  fromRaw,
  RAW_SELECT,
  type RawMetricRow,
  rawRow,
  rollupRow,
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
 * How many index seeks one rollup query may fold together. High enough that a
 * full coalesced chunk costs a handful of round trips instead of hundreds, low
 * enough that no single statement grows unbounded with the chunk.
 */
const SEEKS_PER_QUERY = 64;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function groupBySeries(
  points: readonly CanonicalMetricDataPoint[],
): Map<string, CanonicalMetricDataPoint[]> {
  const bySeries = new Map<string, CanonicalMetricDataPoint[]>();
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
  successorsBySeries: ReadonlyMap<string, CanonicalMetricDataPoint[]>;
}): Map<string, Set<number>> {
  const affectedBySeries = new Map<string, Set<number>>();
  for (const [seriesId, seriesPoints] of bySeries) {
    // Sorted once so each point's successor is a binary search, not a rescan
    // of every candidate — the per-point scan made a single hot series cost
    // O(N²) per chunk. `affectedRollupBuckets` stays the sole owner of the
    // bucket semantics; it just receives the one candidate that can matter.
    const candidates = [
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
  candidates: readonly CanonicalMetricDataPoint[];
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

/** The first point ordering strictly after `point`, from a sorted array. */
function successorIn({
  sorted,
  point,
}: {
  sorted: readonly CanonicalMetricDataPoint[];
  point: CanonicalMetricDataPoint;
}): CanonicalMetricDataPoint | undefined {
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
      logger.error(
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
   * The stored point immediately after each of `points` within its own series.
   * That successor is the only neighbour able to pull a second bucket into the
   * affected set, so it is the only one worth a read — an earlier revision also
   * fetched each point's predecessor and then discarded it.
   *
   * ORDER BY leads with TimeUnixMs to match the table's sort key
   * (TenantId, SeriesId, TimeUnixMs, TimeUnixNano, PointId). TimeUnixMs is
   * derived from TimeUnixNano, so the row order is unchanged — but
   * optimize_read_in_order is syntactic and cannot infer that, so ordering on
   * TimeUnixNano alone made ClickHouse materialise and sort every point in
   * the series (each carrying a ZSTD CanonicalPayload) to return one row.
   * TimeUnixMs is table-qualified throughout: RAW_SELECT aliases
   * toUnixTimestamp64Milli(...) AS TimeUnixMs, and a bare TimeUnixMs
   * resolves to that alias (epoch millis), never matching a DateTime64
   * bound — the same pitfall log-record-storage documents.
   */
  private async successorsOf(
    points: CanonicalMetricDataPoint[],
  ): Promise<CanonicalMetricDataPoint[]> {
    const tenantId = points[0]!.tenantId;
    const client = await this.resolveClient(tenantId);
    const found: CanonicalMetricDataPoint[] = [];

    for (const chunk of chunked(points, SEEKS_PER_QUERY)) {
      const params: Record<string, unknown> = { tenantId };
      const selects = chunk.map((point, index) => {
        params[`series${index}`] = point.seriesId;
        params[`time${index}`] = new Date(point.timeUnixMs);
        params[`nano${index}`] = point.timeUnixNano;
        params[`point${index}`] = point.pointId;
        return `(SELECT ${RAW_SELECT}
          FROM metric_data_points FINAL
          WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
            AND (metric_data_points.TimeUnixMs > {time${index}:DateTime64(3)} OR (metric_data_points.TimeUnixMs = {time${index}:DateTime64(3)} AND (TimeUnixNano > {nano${index}:UInt64} OR (TimeUnixNano = {nano${index}:UInt64} AND PointId > {point${index}:String}))))
          ORDER BY metric_data_points.TimeUnixMs ASC, TimeUnixNano ASC, PointId ASC LIMIT 1)`;
      });
      const result = await client.query({
        query: selects.join("\n UNION ALL\n"),
        query_params: params,
        format: "JSONEachRow",
      });
      for (const row of await result.json<RawMetricRow>()) {
        found.push(fromRaw({ row, organizationId: points[0]!.organizationId }));
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

    // Each seek contributes two statements, so half the budget keeps a single
    // query's statement count at the same ceiling the successor seeks use.
    for (const chunk of chunked(seeks, Math.floor(SEEKS_PER_QUERY / 2))) {
      const params: Record<string, unknown> = { tenantId };
      const selects = chunk.flatMap(({ seriesId, start }, index) => {
        params[`series${index}`] = seriesId;
        params[`from${index}`] = new Date(start);
        params[`to${index}`] = new Date(start + METRIC_ROLLUP_INTERVAL_MS);
        params[`cutoff${index}`] = new Date(
          start - retentionDays * 24 * 60 * 60 * 1000,
        );
        return [
          `(SELECT ${RAW_SELECT}
            FROM metric_data_points FINAL
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs < {from${index}:DateTime64(3)}
              AND metric_data_points.TimeUnixMs >= {cutoff${index}:DateTime64(3)}
            ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`,
          `(SELECT ${RAW_SELECT}
            FROM metric_data_points FINAL
            WHERE TenantId = {tenantId:String} AND SeriesId = {series${index}:String}
              AND metric_data_points.TimeUnixMs >= {from${index}:DateTime64(3)}
              AND metric_data_points.TimeUnixMs < {to${index}:DateTime64(3)}
            ORDER BY metric_data_points.TimeUnixMs ASC, TimeUnixNano ASC, PointId ASC)`,
        ];
      });
      const result = await client.query({
        query: selects.join("\n UNION ALL\n"),
        query_params: params,
        format: "JSONEachRow",
      });
      for (const row of await result.json<RawMetricRow>()) {
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
