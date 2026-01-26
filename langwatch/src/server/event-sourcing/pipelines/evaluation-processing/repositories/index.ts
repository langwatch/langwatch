export { EvaluationStateRepositoryClickHouse } from "./evaluationState.clickhouse.repository";
export { EvaluationStateRepositoryMemory } from "./evaluationState.memory.repository";
export type { EvaluationStateRepository } from "./evaluationState.repository";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { EvaluationStateRepositoryClickHouse } from "./evaluationState.clickhouse.repository";
import { EvaluationStateRepositoryMemory } from "./evaluationState.memory.repository";
import type { EvaluationStateRepository } from "./evaluationState.repository";

// Lazy-loaded repository to avoid calling getClickHouseClient() at module load time
// This prevents t3-env errors when the module is imported in test environments
let _evaluationStateRepository: EvaluationStateRepository | null = null;

/**
 * Gets the evaluation state repository, initializing it lazily on first call.
 * This defers getClickHouseClient() calls until actual use, preventing t3-env
 * errors in test environments where env vars may not be configured yet.
 */
export function getEvaluationStateRepository(): EvaluationStateRepository {
  if (_evaluationStateRepository === null) {
    const clickHouseClient = getClickHouseClient();
    _evaluationStateRepository = clickHouseClient
      ? new EvaluationStateRepositoryClickHouse(clickHouseClient)
      : new EvaluationStateRepositoryMemory();
  }
  return _evaluationStateRepository;
}
