import type { CanonicalMetricDataPoint } from "@langwatch/metric-contract";

import {
  MetricDataPointAppendRepository,
  type MetricDataPointBulkWrite,
  type MetricDataPointWrite,
} from "../metric-data-point-append.repository.ts";

/**
 * Appended data points held in memory. The series catalog and rollups are
 * derived views that only the live tier's queries read, so those writes are no-ops here.
 */
export class MemoryMetricDataPointAppendRepository extends MetricDataPointAppendRepository {
  readonly #points: CanonicalMetricDataPoint[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryMetricDataPointAppendRepository {
    return new MemoryMetricDataPointAppendRepository();
  }

  /** Every point appended so far, in append order. */
  points(): readonly CanonicalMetricDataPoint[] {
    return this.#points;
  }

  async ensureDataPoint({ point }: MetricDataPointWrite): Promise<void> {
    this.#points.push(point);
  }

  async ensureDataPoints({ points }: MetricDataPointBulkWrite): Promise<void> {
    this.#points.push(...points);
  }

  async upsertSeries(_args: MetricDataPointWrite): Promise<void> {}

  async upsertSeriesMany(_args: MetricDataPointBulkWrite): Promise<void> {}

  async recomputeAffectedRollups(_args: MetricDataPointWrite): Promise<void> {}

  async recomputeAffectedRollupsMany(_args: MetricDataPointBulkWrite): Promise<void> {}
}
