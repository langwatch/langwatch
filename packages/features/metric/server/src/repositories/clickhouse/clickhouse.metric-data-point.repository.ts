import { SecurityError } from "@langwatch/eventing";
import type { MetricUsageEstimate, MetricUsageEstimateQuery } from "@langwatch/metric-contract";
import type {
  MetricDataPointBulkWrite,
  MetricDataPointWrite,
} from "../metric-data-point-append.repository";
import {
  MetricDataPointRepository,
  type SeriesTotalByPointAttribute,
} from "../metric-data-point.repository";
import {
  ClickHouseMetricDataPointAppendRepository,
  type MetricClickHouseClient,
  type MetricClickHouseClientResolver,
} from "./clickhouse.metric-data-point-append.repository";

const USAGE_DIMENSIONS: Record<MetricUsageEstimateQuery["groupBy"], string[]> = {
  organization: ["OrganizationId"],
  project: ["OrganizationId", "TenantId"],
  metric: ["OrganizationId", "TenantId", "MetricName"],
  hour: ["OrganizationId", "TenantId", "MetricName", "AcceptedHour"],
};

/**
 * The whole metric surface over ClickHouse: the append half, and the two reads
 * only a query graph makes.
 *
 * The appends are delegated rather than reimplemented. There is one rollup
 * recomputation, one successor seek and one insert path in this package, and a
 * graph that consumes `metric_processing` composes the same
 * {@link ClickHouseMetricDataPointAppendRepository} this class holds — so the
 * two graphs cannot come to disagree about what an append does.
 *
 * Both resolvers are required on purpose. The organization-wide usage query
 * relies on its client being resolved from the organization — that is what
 * makes `OrganizationId` a real isolation boundary rather than a convention
 * (see the carve-out in dev/docs/best_practices/clickhouse-queries.md).
 * Defaulting this to the project resolver would hand it an organization id
 * to look up as a project.
 */
export class MetricDataPointClickHouseRepository extends MetricDataPointRepository {
  private readonly append: ClickHouseMetricDataPointAppendRepository;
  private readonly resolveClient: MetricClickHouseClientResolver;
  private readonly resolveOrganizationClient: MetricClickHouseClientResolver;

  private constructor({
    resolveClient,
    resolveOrganizationClient,
    defaultRetentionDays,
  }: {
    resolveClient: MetricClickHouseClientResolver;
    resolveOrganizationClient: MetricClickHouseClientResolver;
    defaultRetentionDays: number;
  }) {
    super();
    this.append = ClickHouseMetricDataPointAppendRepository.create({
      resolveClient,
      defaultRetentionDays,
    });
    this.resolveClient = resolveClient;
    this.resolveOrganizationClient = resolveOrganizationClient;
  }

  static create(options: {
    resolveClient: MetricClickHouseClientResolver;
    resolveOrganizationClient: MetricClickHouseClientResolver;
    defaultRetentionDays: number;
  }): MetricDataPointClickHouseRepository {
    return new MetricDataPointClickHouseRepository(options);
  }

  async ensureDataPoint(args: MetricDataPointWrite): Promise<void> {
    await this.append.ensureDataPoint(args);
  }

  async ensureDataPoints(args: MetricDataPointBulkWrite): Promise<void> {
    await this.append.ensureDataPoints(args);
  }

  async upsertSeries(args: MetricDataPointWrite): Promise<void> {
    await this.append.upsertSeries(args);
  }

  async upsertSeriesMany(args: MetricDataPointBulkWrite): Promise<void> {
    await this.append.upsertSeriesMany(args);
  }

  async recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void> {
    await this.append.recomputeAffectedRollups(args);
  }

  async recomputeAffectedRollupsMany(args: MetricDataPointBulkWrite): Promise<void> {
    await this.append.recomputeAffectedRollupsMany(args);
  }

  async queryUsageEstimates(query: MetricUsageEstimateQuery): Promise<MetricUsageEstimate[]> {
    if (!query.organizationId) {
      throw new SecurityError(
        "MetricDataPointClickHouseRepository.queryUsageEstimates",
        "organizationId is required",
      );
    }
    const client = query.tenantId
      ? await this.resolveClient(query.tenantId)
      : await this.resolveOrganizationClient(query.organizationId);
    return await MetricDataPointClickHouseRepository.queryMetricUsageEstimates({ client, query });
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
        pointAttributes = JSON.parse(row.PointAttributesJson) as Record<string, string>;
      } catch {
        // Malformed row: keep the attribute-less default.
      }
      return {
        metricName: row.MetricName,
        total: Number(row.Total),
        pointAttributes,
      };
    });
  }

  private static async queryMetricUsageEstimates({
    client,
    query,
  }: {
    client: MetricClickHouseClient;
    query: MetricUsageEstimateQuery;
  }): Promise<MetricUsageEstimate[]> {
    const dimensions = USAGE_DIMENSIONS[query.groupBy];
    const selectDimensions = dimensions.join(", ");
    const identityWhere = [
      "OrganizationId = {organizationId:String}",
      // First acceptance determines billing. The lower window bound belongs in
      // HAVING so min(AcceptedAt) can deduplicate a point across month partitions.
      "AcceptedAt < {to:DateTime64(3)}",
      query.tenantId ? "TenantId = {tenantId:String}" : "",
      query.metricName ? "MetricName = {metricName:String}" : "",
    ]
      .filter(Boolean)
      .join(" AND ");

    const result = await client.query({
      query: `
        SELECT
          ${selectDimensions},
          uniqExact(SeriesId) AS UniqueActiveSeries,
          uniqExact(tuple(SeriesId, AcceptedHour)) AS ActiveSeriesHours,
          uniqExact(PointId) AS AcceptedPoints,
          sum(CanonicalSourceBytes) AS CanonicalRetainedBytes,
          ActiveSeriesHours AS ProjectedEventEquivalentUsage
          FROM (
          SELECT
            PointId,
            any(OrganizationId) AS OrganizationId,
            any(TenantId) AS TenantId,
            any(SeriesId) AS SeriesId,
            any(MetricName) AS MetricName,
            min(AcceptedAt) AS AcceptedAt,
            toStartOfHour(min(AcceptedAt)) AS AcceptedHour,
            any(CanonicalSourceBytes) AS CanonicalSourceBytes
          FROM metric_usage_estimates
          WHERE ${identityWhere}
          GROUP BY PointId
          HAVING min(AcceptedAt) >= {from:DateTime64(3)}
        )
        GROUP BY ${selectDimensions}
        ORDER BY ${selectDimensions}
      `,
      query_params: {
        organizationId: query.organizationId,
        from: query.from,
        to: query.to,
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.metricName ? { metricName: query.metricName } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, string>>();

    return rows.map((row) => ({
      organizationId: row.OrganizationId!,
      tenantId: row.TenantId ?? null,
      metricName: row.MetricName ?? null,
      acceptedHour: row.AcceptedHour ?? null,
      uniqueActiveSeries: Number(row.UniqueActiveSeries ?? 0),
      activeSeriesHours: Number(row.ActiveSeriesHours ?? 0),
      acceptedPoints: Number(row.AcceptedPoints ?? 0),
      canonicalRetainedBytes: Number(row.CanonicalRetainedBytes ?? 0),
      projectedEventEquivalentUsage: Number(row.ProjectedEventEquivalentUsage ?? 0),
    }));
  }
}
