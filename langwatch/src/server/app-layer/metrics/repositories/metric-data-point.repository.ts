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

/** One series' total over a window, with the label set that identifies it. */
export interface SeriesTotalByPointAttribute {
  metricName: string;
  /** Sum of the delta-converged rollup buckets — the series' total. */
  total: number;
  pointAttributes: Record<string, string>;
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
  /**
   * Totals for every series whose point-attribute set carries
   * `attributeKey = attributeValue`, summed from the 30-second rollups
   * (delta-converged, so the sum IS the total regardless of the source
   * temporality). This is the session-keyed read coding agents need: their
   * metrics carry no exemplars, so they can never correlate to a trace, but
   * `session.id` rides the datapoint attributes.
   */
  getSeriesTotalsByPointAttribute(args: {
    tenantId: string;
    attributeKey: string;
    attributeValue: string;
    /** Partition-pruning lower bound for the rollup scan. */
    fromMs: number;
  }): Promise<SeriesTotalByPointAttribute[]>;
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

  async getSeriesTotalsByPointAttribute(_args: {
    tenantId: string;
    attributeKey: string;
    attributeValue: string;
    fromMs: number;
  }): Promise<SeriesTotalByPointAttribute[]> {
    return [];
  }
}
