import type { EvaluationCostRepository } from "./evaluation-cost.repository.ts";
import type { EvaluationRunRepository } from "./evaluation.repository.ts";
import type { MonitorPerformanceRepository } from "./monitor-performance.repository.ts";

/**
 * The rows Evaluation owns: the cost ledger in Prisma, run history and the
 * monitor trend in ClickHouse.
 */
export interface EvaluationRepositories {
  readonly costs: EvaluationCostRepository;
  readonly runs: EvaluationRunRepository;
  readonly monitorPerformance: MonitorPerformanceRepository;
}
