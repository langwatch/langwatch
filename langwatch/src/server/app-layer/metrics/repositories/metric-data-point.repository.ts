import type {
  CanonicalMetricDataPoint,
  MetricUsageEstimate,
  MetricUsageEstimateQuery,
} from "~/server/event-sourcing/pipelines/metric-processing/schemas/metricDataPoint";

export interface MetricDataPointRepository {
  ensureDataPoint(
    point: CanonicalMetricDataPoint,
    retentionDays?: number,
  ): Promise<void>;
  upsertSeries(
    point: CanonicalMetricDataPoint,
    retentionDays?: number,
  ): Promise<void>;
  recomputeAffectedRollups(
    point: CanonicalMetricDataPoint,
    retentionDays?: number,
  ): Promise<void>;
  queryUsageEstimates(
    query: MetricUsageEstimateQuery,
  ): Promise<MetricUsageEstimate[]>;
}

export class NullMetricDataPointRepository implements MetricDataPointRepository {
  async ensureDataPoint(
    _point: CanonicalMetricDataPoint,
    _retentionDays?: number,
  ): Promise<void> {}

  async upsertSeries(
    _point: CanonicalMetricDataPoint,
    _retentionDays?: number,
  ): Promise<void> {}

  async recomputeAffectedRollups(
    _point: CanonicalMetricDataPoint,
    _retentionDays?: number,
  ): Promise<void> {}

  async queryUsageEstimates(
    _query: MetricUsageEstimateQuery,
  ): Promise<MetricUsageEstimate[]> {
    return [];
  }
}
