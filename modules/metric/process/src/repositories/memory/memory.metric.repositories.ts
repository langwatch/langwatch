import type { MetricRepositories } from "../metric.repositories.ts";
import { MemoryMetricDataPointAppendRepository } from "./memory.metric-data-point-append.repository.ts";

/** The memory tier: the data points held in the process, with no store. */
export class MemoryMetricRepositories {
  static readonly requires = [] as const;

  static create(): MetricRepositories {
    return { dataPoints: MemoryMetricDataPointAppendRepository.create() };
  }
}
