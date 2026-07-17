import type {
  CanonicalMetricDataPoint,
  MetricUsageEstimate,
  MetricUsageEstimateQuery,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";

export interface MetricDataPointWrite {
  point: CanonicalMetricDataPoint;
  retentionDays?: number;
}

/** A replay chunk: many points for one tenant, written in one round trip. */
export interface MetricDataPointBulkWrite {
  points: CanonicalMetricDataPoint[];
  retentionDays?: number;
}

export interface MetricDataPointRepository {
  ensureDataPoint(args: MetricDataPointWrite): Promise<void>;
  ensureDataPoints(args: MetricDataPointBulkWrite): Promise<void>;
  upsertSeries(args: MetricDataPointWrite): Promise<void>;
  upsertSeriesMany(args: MetricDataPointBulkWrite): Promise<void>;
  recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void>;
  recomputeAffectedRollupsMany(args: MetricDataPointBulkWrite): Promise<void>;
  queryUsageEstimates(
    query: MetricUsageEstimateQuery,
  ): Promise<MetricUsageEstimate[]>;
}

export class NullMetricDataPointRepository implements MetricDataPointRepository {
  async ensureDataPoint(_args: MetricDataPointWrite): Promise<void> {}

  async ensureDataPoints(_args: MetricDataPointBulkWrite): Promise<void> {}

  async upsertSeries(_args: MetricDataPointWrite): Promise<void> {}

  async upsertSeriesMany(_args: MetricDataPointBulkWrite): Promise<void> {}

  async recomputeAffectedRollups(_args: MetricDataPointWrite): Promise<void> {}

  async recomputeAffectedRollupsMany(
    _args: MetricDataPointBulkWrite,
  ): Promise<void> {}

  async queryUsageEstimates(
    _query: MetricUsageEstimateQuery,
  ): Promise<MetricUsageEstimate[]> {
    return [];
  }
}
