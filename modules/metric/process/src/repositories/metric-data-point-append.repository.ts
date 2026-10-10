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
 * Append-only for metric processing: canonical points, series catalog, rollups. Separate
 * port avoids requiring organization-keyed ClickHouse resolver that background workers
 * (routing only by tenant) would never call.
 */
export abstract class MetricDataPointAppendRepository {
  abstract ensureDataPoint(args: MetricDataPointWrite): Promise<void>;

  abstract ensureDataPoints(args: MetricDataPointBulkWrite): Promise<void>;

  abstract upsertSeries(args: MetricDataPointWrite): Promise<void>;

  abstract upsertSeriesMany(args: MetricDataPointBulkWrite): Promise<void>;

  abstract recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void>;

  abstract recomputeAffectedRollupsMany(args: MetricDataPointBulkWrite): Promise<void>;
}
