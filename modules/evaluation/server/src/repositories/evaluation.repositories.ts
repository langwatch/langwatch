import type { EvaluationCostRepository } from "./evaluation-cost.repository.ts";

/**
 * The rows Evaluation owns in the relational store. The run history, the
 * analytics rollups and the monitor trend are ClickHouse reads and arrive
 * through members instead.
 */
export interface EvaluationRepositories {
  readonly costs: EvaluationCostRepository;
}
