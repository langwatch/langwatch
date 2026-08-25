import type { MonitorPerformanceQuery } from "@langwatch/evaluation-contract";

export type MonitorPerformanceBucket = {
  evaluatorId: string;
  period: "current" | "previous";
  day: string;
  scoreSum: number;
  scoreCount: number;
  passSum: number;
  passCount: number;
};

/** Private ClickHouse read model for monitor performance. */
export abstract class MonitorPerformanceRepository {
  abstract findBuckets(
    input: Omit<MonitorPerformanceQuery, "monitors"> & {
      evaluatorIds: string[];
    },
  ): Promise<MonitorPerformanceBucket[]>;
}
