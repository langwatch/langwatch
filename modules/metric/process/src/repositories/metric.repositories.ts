import type { MetricDataPointAppendRepository } from "./metric-data-point-append.repository.ts";

/** The rows this module owns: the canonical data points its pipeline appends. */
export interface MetricRepositories {
  readonly dataPoints: MetricDataPointAppendRepository;
}
