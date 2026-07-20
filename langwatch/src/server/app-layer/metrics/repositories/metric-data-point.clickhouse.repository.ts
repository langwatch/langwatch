import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  affectedRollupBuckets,
  buildMetricRollups,
} from "~/server/event-sourcing/pipelines/metric-processing/rollup";
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
} from "./metric-data-point.repository";
import {
  fromRaw,
  RAW_SELECT,
  rawRow,
  rollupRow,
  seriesRow,
  usageEstimateRow,
  validatePoint,
  type RawMetricRow,
} from "./metric-data-point.rows";
import { queryMetricUsageEstimates } from "./metric-data-point.usage";

const logger = createLogger(
  "langwatch:app-layer:metrics:metric-data-point-repository",
);

const INSERT_SETTINGS = { async_insert: 1, wait_for_async_insert: 1 } as const;

export class MetricDataPointClickHouseRepository implements MetricDataPointRepository {
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
   * Recomputes a chunk's rollups per series rather than per point: the
   * authoritative fetch and the row write are what cost round trips, and every
   * point of a series shares them. Ensuring the raw points up front also makes
   * the result independent of the order the chunk happens to arrive in.
   */
  async recomputeAffectedRollupsMany({
    points,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  }: MetricDataPointBulkWrite): Promise<void> {
    if (points.length === 0) return;
    // Projection queues are independent. Ensuring the points here makes the
    // raw-before-derived invariant true even if this projection wins the race.
    await this.ensureDataPoints({ points, retentionDays });

    const bySeries = new Map<string, CanonicalMetricDataPoint[]>();
    for (const point of points) {
      bySeries.set(point.seriesId, [
        ...(bySeries.get(point.seriesId) ?? []),
        point,
      ]);
    }

    const rows: MetricRollupRow[] = [];
    for (const seriesPoints of bySeries.values()) {
      rows.push(...(await this.rollupRowsForSeries(seriesPoints)));
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

  private async rollupRowsForSeries(
    points: CanonicalMetricDataPoint[],
  ): Promise<MetricRollupRow[]> {
    const affected = new Set<number>();
    for (const point of points) {
      const neighbors = await this.immediateNeighbors(point);
      for (const bucket of affectedRollupBuckets({
        points: neighbors,
        insertedPoint: point,
      })) {
        affected.add(bucket);
      }
    }
    const authoritative = await this.pointsForBuckets(points[0]!, affected);
    return buildMetricRollups({
      points: authoritative,
      affectedBuckets: affected,
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

  private async immediateNeighbors(
    point: CanonicalMetricDataPoint,
  ): Promise<CanonicalMetricDataPoint[]> {
    const client = await this.resolveClient(point.tenantId);
    // ORDER BY leads with TimeUnixMs to match the table's sort key
    // (TenantId, SeriesId, TimeUnixMs, TimeUnixNano, PointId). TimeUnixMs is
    // derived from TimeUnixNano, so the row order is unchanged — but
    // optimize_read_in_order is syntactic and cannot infer that, so ordering on
    // TimeUnixNano alone made ClickHouse materialise and sort every point in
    // the series (each carrying a ZSTD CanonicalPayload) to return one row.
    // TimeUnixMs is table-qualified throughout: RAW_SELECT aliases
    // toUnixTimestamp64Milli(...) AS TimeUnixMs, and a bare TimeUnixMs
    // resolves to that alias (epoch millis), never matching a DateTime64
    // bound — the same pitfall log-record-storage documents.
    const result = await client.query({
      query: `
        (SELECT ${RAW_SELECT}
         FROM metric_data_points FINAL
         WHERE TenantId = {tenantId:String} AND SeriesId = {seriesId:String}
           AND (metric_data_points.TimeUnixMs < {time:DateTime64(3)} OR (metric_data_points.TimeUnixMs = {time:DateTime64(3)} AND (TimeUnixNano < {timeNano:UInt64} OR (TimeUnixNano = {timeNano:UInt64} AND PointId < {pointId:String}))))
         ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)
        UNION ALL
        (SELECT ${RAW_SELECT}
         FROM metric_data_points FINAL
         WHERE TenantId = {tenantId:String} AND SeriesId = {seriesId:String}
           AND (metric_data_points.TimeUnixMs > {time:DateTime64(3)} OR (metric_data_points.TimeUnixMs = {time:DateTime64(3)} AND (TimeUnixNano > {timeNano:UInt64} OR (TimeUnixNano = {timeNano:UInt64} AND PointId >= {pointId:String}))))
         ORDER BY metric_data_points.TimeUnixMs ASC, TimeUnixNano ASC, PointId ASC LIMIT 2)
      `,
      query_params: {
        tenantId: point.tenantId,
        seriesId: point.seriesId,
        time: new Date(point.timeUnixMs),
        timeNano: point.timeUnixNano,
        pointId: point.pointId,
      },
      format: "JSONEachRow",
    });
    return (await result.json<RawMetricRow>()).map((row) =>
      fromRaw({ row, organizationId: point.organizationId }),
    );
  }

  /**
   * Every point in the affected buckets, each preceded by the sample the fold
   * differences it against. Buckets are fetched as their own narrow ranges
   * rather than one span: a late point and a distant next sample would
   * otherwise scan every partition between them only to discard the rows.
   */
  private async pointsForBuckets(
    point: CanonicalMetricDataPoint,
    buckets: ReadonlySet<number>,
  ): Promise<CanonicalMetricDataPoint[]> {
    const starts = [...buckets].sort((a, b) => a - b);
    if (starts.length === 0) return [];
    const params: Record<string, unknown> = {
      tenantId: point.tenantId,
      seriesId: point.seriesId,
    };
    const selects = starts.flatMap((start, index) => {
      params[`from${index}`] = new Date(start);
      params[`to${index}`] = new Date(start + METRIC_ROLLUP_INTERVAL_MS);
      return [
        `(SELECT ${RAW_SELECT}
          FROM metric_data_points FINAL
          WHERE TenantId = {tenantId:String} AND SeriesId = {seriesId:String}
            AND metric_data_points.TimeUnixMs < {from${index}:DateTime64(3)}
          ORDER BY metric_data_points.TimeUnixMs DESC, TimeUnixNano DESC, PointId DESC LIMIT 1)`,
        `(SELECT ${RAW_SELECT}
          FROM metric_data_points FINAL
          WHERE TenantId = {tenantId:String} AND SeriesId = {seriesId:String}
            AND metric_data_points.TimeUnixMs >= {from${index}:DateTime64(3)}
            AND metric_data_points.TimeUnixMs < {to${index}:DateTime64(3)}
          ORDER BY metric_data_points.TimeUnixMs ASC, TimeUnixNano ASC, PointId ASC)`,
      ];
    });
    const client = await this.resolveClient(point.tenantId);
    const result = await client.query({
      query: selects.join("\n UNION ALL\n"),
      query_params: params,
      format: "JSONEachRow",
    });
    // A bucket's predecessor may itself sit in an earlier affected bucket, so
    // the ranges overlap by design; the fold needs each point exactly once.
    const unique = new Map<string, CanonicalMetricDataPoint>();
    for (const row of await result.json<RawMetricRow>()) {
      const parsed = fromRaw({ row, organizationId: point.organizationId });
      unique.set(parsed.pointId, parsed);
    }
    return [...unique.values()];
  }
}
