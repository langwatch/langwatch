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

/** One project's runs of one evaluator with one error code ("" for runs that did not error). */
export type EvaluatorOutcomeRow = {
  evaluatorId: string;
  evaluatorType: string;
  errorCode: string;
  runs: number;
  errors: number;
  skipped: number;
  lastErrorAt: number | null;
};

export type EvaluatorOutcomeRowQuery = {
  tenantId: string;
  since: number;
  until: number;
  limit: number;
};

/** Every tenant's runs of one evaluator type; `errorsByCode` holds only codes that errored. */
export type EvaluatorTypeUsageRow = {
  evaluatorType: string;
  projects: number;
  runs: number;
  errors: number;
  skipped: number;
  errorsByCode: Record<string, number>;
};

export type EvaluatorTypeUsageRowQuery = {
  since: number;
  until: number;
  limit: number;
};

/** Private ClickHouse read model for monitor performance. */
export abstract class MonitorPerformanceRepository {
  abstract findBuckets(input: MonitorPerformanceBucketQuery): Promise<MonitorPerformanceBucket[]>;
  /** Each run scheduled in `[since, until)` at its latest revision, per evaluator and code. */
  abstract findOutcomeRows(input: EvaluatorOutcomeRowQuery): Promise<EvaluatorOutcomeRow[]>;
  /** Every tenant's runs scheduled in `[since, until)` at their latest revision, per type. */
  abstract findTypeUsageRows(input: EvaluatorTypeUsageRowQuery): Promise<EvaluatorTypeUsageRow[]>;
}
