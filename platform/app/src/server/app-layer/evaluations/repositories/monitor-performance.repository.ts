export type MonitorPerformancePeriod = "current" | "previous";

export interface MonitorPerformanceBucket {
  evaluatorId: string;
  period: MonitorPerformancePeriod;
  day: string;
  scoreSum: number;
  scoreCount: number;
  passSum: number;
  passCount: number;
  /**
   * How many results carried each label that day. Empty for evaluators that
   * score or pass rather than classify; the only reading a category
   * evaluator produces, since it leaves score and pass empty.
   */
  labelCounts: Record<string, number>;
}

export interface FindMonitorPerformanceParams {
  tenantId: string;
  evaluatorIds: string[];
  previousStartMs: number;
  currentStartMs: number;
  endMs: number;
  timeZone: string;
}

export interface MonitorPerformanceRepository {
  findBuckets(
    params: FindMonitorPerformanceParams,
  ): Promise<MonitorPerformanceBucket[]>;
}

export class NullMonitorPerformanceRepository
  implements MonitorPerformanceRepository
{
  async findBuckets(
    _params: FindMonitorPerformanceParams,
  ): Promise<MonitorPerformanceBucket[]> {
    return [];
  }
}
