import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";

export interface MetricDataPointWrite {
  point: CanonicalMetricDataPoint;
  retentionDays?: number;
}

/** A replay chunk: many points for one tenant, written in one round trip. */
export interface MetricDataPointBulkWrite {
  points: CanonicalMetricDataPoint[];
  retentionDays?: number;
}

/**
 * The six calls durable metric processing makes, and nothing else.
 *
 * The pipeline's three map projections append through this port: canonical
 * points, the series catalog, and the 30-second rollups. None of them reads,
 * so none of them needs the organization-keyed ClickHouse client that the
 * usage-estimate query on {@link MetricDataPointRepository} does — and that
 * client is the whole reason this port is separate. A process that only
 * consumes `metric_processing` (the background worker) can route a tenant to
 * its ClickHouse instance and can not route an organization to one; demanding
 * an organization resolver it would never call is what kept the pipeline
 * uncomposable outside the App.
 */
export abstract class MetricDataPointAppendRepository {
  abstract ensureDataPoint(args: MetricDataPointWrite): Promise<void>;

  abstract ensureDataPoints(args: MetricDataPointBulkWrite): Promise<void>;

  abstract upsertSeries(args: MetricDataPointWrite): Promise<void>;

  abstract upsertSeriesMany(args: MetricDataPointBulkWrite): Promise<void>;

  abstract recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void>;

  abstract recomputeAffectedRollupsMany(args: MetricDataPointBulkWrite): Promise<void>;
}
