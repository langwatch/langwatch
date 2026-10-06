import type { LangevalsPayloadStaging } from "../channels/langevals.channel.ts";
import type { EvaluationAnalyticsFoldCacheRepository } from "./evaluation-analytics-fold-cache.repository.ts";
import type { EvaluationCostRepository } from "./evaluation-cost.repository.ts";
import type { EvaluationInputRepository } from "./evaluation-input.repository.ts";
import type { EvaluationRunRepository } from "./evaluation.repository.ts";
import type { MonitorPerformanceRepository } from "./monitor-performance.repository.ts";

/**
 * The rows Evaluation owns: the cost ledger in Prisma, run history and the
 * monitor trend in ClickHouse, the analytics fold's cache in Redis, oversized
 * inputs and staged langevals payloads in object storage.
 */
export interface EvaluationRepositories {
  readonly costs: EvaluationCostRepository;
  readonly runs: EvaluationRunRepository;
  readonly monitorPerformance: MonitorPerformanceRepository;
  readonly analyticsFoldCache: EvaluationAnalyticsFoldCacheRepository;
  readonly inputs: EvaluationInputRepository;
  /** Parks an oversized langevals body in object storage while its call is in flight. */
  readonly langevalsStaging: LangevalsPayloadStaging;
}
