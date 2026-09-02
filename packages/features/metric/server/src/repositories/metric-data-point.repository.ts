import type { MetricUsageEstimate, MetricUsageEstimateQuery } from "@langwatch/metric-contract";
import { MetricDataPointAppendRepository } from "./metric-data-point-append.repository";

/** One series' total over a window, with the label set that identifies it. */
export interface SeriesTotalByPointAttribute {
  metricName: string;
  /** Sum of the delta-converged rollup buckets — the series' total. */
  total: number;
  pointAttributes: Record<string, string>;
}

/**
 * The whole metric surface: the append port durable processing uses, plus the
 * two reads that only a query graph makes.
 */
export abstract class MetricDataPointRepository extends MetricDataPointAppendRepository {
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
