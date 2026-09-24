import type { EvaluationAnalyticsFoldCacheRepository } from "./evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationCostRepository } from "./evaluation-cost.repository.ts";
import type { EvaluationRunRepository } from "./evaluation.repository.ts";
import type { MonitorPerformanceRepository } from "./monitor-performance.repository.ts";

/**
 * The rows Evaluation owns: the cost ledger in Prisma, run history and the
 * monitor trend in ClickHouse, the analytics fold's cache in Redis.
 */
export interface EvaluationRepositories {
  readonly costs: EvaluationCostRepository;
  readonly runs: EvaluationRunRepository;
  readonly monitorPerformance: MonitorPerformanceRepository;
  readonly analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
}
