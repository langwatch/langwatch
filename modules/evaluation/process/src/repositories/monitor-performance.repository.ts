export type MonitorPerformanceBucket = {
  evaluatorId: string;
  period: "current" | "previous";
  day: string;
  scoreSum: number;
  scoreCount: number;
  passSum: number;
  passCount: number;
  /** Results per label that day; empty for evaluators that only score or pass. */
  labelCounts: Record<string, number>;
};

export type MonitorPerformanceBucketQuery = {
  tenantId: string;
  evaluatorIds: string[];
  previousStartMs: number;
  currentStartMs: number;
  endMs: number;
  timeZone: string;
};

/** Private ClickHouse read model for monitor performance. */
export abstract class MonitorPerformanceRepository {
  abstract findBuckets(input: MonitorPerformanceBucketQuery): Promise<MonitorPerformanceBucket[]>;
}
