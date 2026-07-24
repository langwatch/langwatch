export type MonitorPerformancePeriod = "current" | "previous";

export interface MonitorPerformanceBucket {
  evaluatorId: string;
  period: MonitorPerformancePeriod;
  day: string;
  scoreSum: number;
  scoreCount: number;
  passSum: number;
  passCount: number;
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
