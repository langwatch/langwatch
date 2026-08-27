import type {
  CanonicalMetricDataPoint,
  MetricUsageEstimate,
  MetricUsageEstimateQuery,
} from "@langwatch/metric-contract";

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

export abstract class MetricDataPointRepository {
  abstract ensureDataPoint(args: MetricDataPointWrite): Promise<void>;

  abstract ensureDataPoints(args: MetricDataPointBulkWrite): Promise<void>;

  abstract upsertSeries(args: MetricDataPointWrite): Promise<void>;

  abstract upsertSeriesMany(args: MetricDataPointBulkWrite): Promise<void>;

  abstract recomputeAffectedRollups(args: MetricDataPointWrite): Promise<void>;

  abstract recomputeAffectedRollupsMany(args: MetricDataPointBulkWrite): Promise<void>;

  abstract queryUsageEstimates(query: MetricUsageEstimateQuery): Promise<MetricUsageEstimate[]>;

  /**
   * Totals for every series whose point-attribute set carries
   * `attributeKey = attributeValue`, summed from the 30-second rollups
   * (delta-converged, so the sum IS the total regardless of the source
   * temporality). This is the session-keyed read coding agents need: their
   * metrics carry no exemplars, so they can never correlate to a trace, but
   * `session.id` rides the datapoint attributes.
   */
  abstract getSeriesTotalsByPointAttribute(args: {
    tenantId: string;
    attributeKey: string;
    attributeValue: string;
    /** Partition-pruning lower bound for the rollup scan. */
    fromMs: number;
  }): Promise<SeriesTotalByPointAttribute[]>;
}
