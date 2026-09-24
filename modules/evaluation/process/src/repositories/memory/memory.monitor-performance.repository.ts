import {
  MonitorPerformanceRepository,
  type MonitorPerformanceBucket,
} from "../monitor-performance.repository.ts";

/** The trend over no traces: nothing in this module writes the rows it folds. */
export class MemoryMonitorPerformanceRepository extends MonitorPerformanceRepository {
  static create(): MemoryMonitorPerformanceRepository {
    return new MemoryMonitorPerformanceRepository();
  }

  private constructor() {
    super();
  }

  async findBuckets(): Promise<MonitorPerformanceBucket[]> {
    return [];
  }
}
