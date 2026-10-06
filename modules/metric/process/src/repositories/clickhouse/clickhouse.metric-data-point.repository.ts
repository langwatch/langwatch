import { SecurityError } from "@langwatch/eventing";
import type { MetricUsageEstimate, MetricUsageEstimateQuery } from "@langwatch/metric-contract";
import { createLogger } from "@langwatch/observability";
import { toDate } from "@langwatch/time";

import type {
  MetricDataPointBulkWrite,
  MetricDataPointWrite,
} from "../metric-data-point-append.repository.ts";
import {
  MetricDataPointRepository,
  type SeriesTotalByPointAttribute,
} from "../metric-data-point.repository.ts";
import {
  ClickHouseMetricDataPointAppendRepository,
  type MetricClickHouseClient,
  type MetricClickHouseClientResolver,
} from "./clickhouse.metric-data-point-append.repository.ts";
import { clickHouseTimestamp } from "./clickhouse.metric-data-point.mapper.ts";

const logger = createLogger("langwatch:metric:metric-data-point-repository");

const USAGE_DIMENSIONS: Record<MetricUsageEstimateQuery["groupBy"], string[]> = {
  organization: ["OrganizationId"],
  project: ["OrganizationId", "TenantId"],
  metric: ["OrganizationId", "TenantId", "MetricName"],
  hour: ["OrganizationId", "TenantId", "MetricName", "AcceptedHour"],
};

/**
 * The whole metric surface over ClickHouse: the append half, and the two reads only a query
 * graph makes. The appends are delegated rather than reimplemented.
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
      throw new SecurityError({
        operation: "MetricDataPointClickHouseRepository.queryUsageEstimates",
        message: "organizationId is required",
      });
    }
    const client = query.tenantId
      ? await this.resolveClient(query.tenantId)
      : await this.resolveOrganizationClient(query.organizationId);
    return MetricDataPointClickHouseRepository.queryMetricUsageEstimates({ client, query });
  }

  async findSeriesTotalsByPointAttribute({
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
      throw new SecurityError({
        operation: "MetricDataPointClickHouseRepository.findSeriesTotalsByPointAttribute",
        message: "tenantId is required",
      });
    }
    const client = await this.resolveClient(tenantId);
    // Two hops in one query: the series catalog names the label-matched SeriesIds (deduped with
    // argMax, never relying on a merge), then the delta-converged rollups sum to the series
    // total. `has(PointAttributeKeys, ...)` gates the JSON extraction to rows that can match.
    // Columns go through the table alias `s`: PointAttributesJson is also a SELECT alias, and
    // unqualified it would put the aggregate in WHERE.
    const result = await client.query({
      query: `
        WITH matched AS (
          SELECT
            s.SeriesId AS SeriesId,
            argMax(s.MetricName, s.LastSeenAt) AS MetricName,
            argMax(s.PointAttributesJson, s.LastSeenAt) AS PointAttributesJson
          FROM metric_series AS s
          WHERE s.TenantId = {tenantId:String}
            AND has(s.PointAttributeKeys, {attributeKey:String})
            AND JSONExtractString(s.PointAttributesJson, {attributeKey:String}) = {attributeValue:String}
          GROUP BY s.SeriesId
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
        fromMs: clickHouseTimestamp(fromMs),
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
      } catch (error) {
        logger.warn(
          { tenantId, metricName: row.MetricName, error },
          "Malformed metric point attributes JSON; using empty attributes",
        );
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
      "u.OrganizationId = {organizationId:String}",
      // First acceptance determines billing. The lower window bound belongs in
      // HAVING so min(AcceptedAt) can deduplicate a point across month partitions.
      // Qualified with the table alias: the SELECT aliases reuse these column names,
      // and an unqualified name in WHERE would resolve to the aggregate.
      "u.AcceptedAt < {to:DateTime64(3)}",
      query.tenantId ? "u.TenantId = {tenantId:String}" : "",
      query.metricName ? "u.MetricName = {metricName:String}" : "",
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
            u.PointId AS PointId,
            any(u.OrganizationId) AS OrganizationId,
            any(u.TenantId) AS TenantId,
            any(u.SeriesId) AS SeriesId,
            any(u.MetricName) AS MetricName,
            min(u.AcceptedAt) AS AcceptedAt,
            toStartOfHour(min(u.AcceptedAt)) AS AcceptedHour,
            any(u.CanonicalSourceBytes) AS CanonicalSourceBytes
          FROM metric_usage_estimates AS u
          WHERE ${identityWhere}
          GROUP BY u.PointId
          HAVING min(u.AcceptedAt) >= {from:DateTime64(3)}
        )
        GROUP BY ${selectDimensions}
        ORDER BY ${selectDimensions}
      `,
      query_params: {
        organizationId: query.organizationId,
        from: toDate(query.from),
        to: toDate(query.to),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.metricName ? { metricName: query.metricName } : {}),
      },
      format: "JSONEachRow",
      unscoped: {
        reason:
          "Organization-wide usage rollup: billing counts every project the organization owns, so OrganizationId is the scope and TenantId narrows it only when one project was asked for.",
      },
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
