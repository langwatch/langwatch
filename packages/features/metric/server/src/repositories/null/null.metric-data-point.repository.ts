import type { MetricUsageEstimate, MetricUsageEstimateQuery } from "@langwatch/metric-contract";
import type {
  MetricDataPointBulkWrite,
  MetricDataPointWrite,
} from "../metric-data-point-append.repository";
import {
  MetricDataPointRepository,
  type SeriesTotalByPointAttribute,
} from "../metric-data-point.repository";

export class NullMetricDataPointRepository extends MetricDataPointRepository {
  private constructor() {
    super();
  }

  static create(): NullMetricDataPointRepository {
    return new NullMetricDataPointRepository();
  }

  async ensureDataPoint(_args: MetricDataPointWrite): Promise<void> {}

  async ensureDataPoints(_args: MetricDataPointBulkWrite): Promise<void> {}

  async upsertSeries(_args: MetricDataPointWrite): Promise<void> {}

  async upsertSeriesMany(_args: MetricDataPointBulkWrite): Promise<void> {}

  async recomputeAffectedRollups(_args: MetricDataPointWrite): Promise<void> {}

  async recomputeAffectedRollupsMany(_args: MetricDataPointBulkWrite): Promise<void> {}

  async queryUsageEstimates(_query: MetricUsageEstimateQuery): Promise<MetricUsageEstimate[]> {
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
