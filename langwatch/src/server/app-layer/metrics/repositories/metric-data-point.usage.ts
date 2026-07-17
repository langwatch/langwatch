import type { ClickHouseClient } from "@clickhouse/client";
import type {
  MetricUsageEstimate,
  MetricUsageEstimateQuery,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";

const DIMENSIONS: Record<MetricUsageEstimateQuery["groupBy"], string[]> = {
  organization: ["OrganizationId"],
  project: ["OrganizationId", "TenantId"],
  metric: ["OrganizationId", "TenantId", "MetricName"],
  hour: ["OrganizationId", "TenantId", "MetricName", "AcceptedHour"],
};

/**
 * Usage estimates over the shadow ledger.
 *
 * Tenant-isolation carve-out (see dev/docs/best_practices/clickhouse-queries.md,
 * "Carve-out: organization-scoped billing ledgers"): `metric_usage_estimates`
 * is the only table keyed by `(OrganizationId, TenantId, PointId)`, and its
 * client is resolved from the organization — which is what selects the physical
 * ClickHouse instance in the first place, so an organization can never read
 * another's rows. `OrganizationId` leads the predicate because it leads the
 * sort key; `TenantId` narrows it whenever the caller supplies one.
 */
export async function queryMetricUsageEstimates({
  client,
  query,
}: {
  client: ClickHouseClient;
  query: MetricUsageEstimateQuery;
}): Promise<MetricUsageEstimate[]> {
  const dimensions = DIMENSIONS[query.groupBy];
  const selectDimensions = dimensions.join(", ");
  const identityWhere = [
    "OrganizationId = {organizationId:String}",
    // Upper bound only, deliberately. A point is billed at its FIRST
    // acceptance, and this GROUP BY is the only thing that dedups a PointId
    // across months — the table partitions by AcceptedAt, so ReplacingMergeTree
    // cannot collapse the same point's rows across two months (see the KNOWN
    // TENSION note in migration 00042). An `AcceptedAt >= {from}` predicate here
    // would therefore hide the original row from the min() and re-bill a point
    // whose first acceptance predates the window. OrganizationId leads the sort
    // key and the TTL is 13 months, so the missing lower bound costs this org's
    // rows across at most 13 partitions, not a table scan.
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
        uniqExact(tuple(SeriesId, AcceptedHour)) AS ProjectedEventEquivalentUsage
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
