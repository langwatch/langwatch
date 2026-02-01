export { BatchEvaluationRunStateRepositoryClickHouse } from "./batchEvaluationRunState.clickhouse.repository";
export { BatchEvaluationRunStateRepositoryMemory } from "./batchEvaluationRunState.memory.repository";
export type { BatchEvaluationRunStateRepository } from "./batchEvaluationRunState.repository";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { BatchEvaluationRunStateRepositoryClickHouse } from "./batchEvaluationRunState.clickhouse.repository";
import { BatchEvaluationRunStateRepositoryMemory } from "./batchEvaluationRunState.memory.repository";
import type { BatchEvaluationRunStateRepository } from "./batchEvaluationRunState.repository";

// Lazy-loaded repository to avoid calling getClickHouseClient() at module load time
// This prevents t3-env errors when the module is imported in test environments
let _batchEvaluationRunStateRepository: BatchEvaluationRunStateRepository | null =
  null;

/**
 * Gets the batch evaluation run state repository, initializing it lazily on first call.
 * This defers getClickHouseClient() calls until actual use, preventing t3-env
 * errors in test environments where env vars may not be configured yet.
 */
export function getBatchEvaluationRunStateRepository(): BatchEvaluationRunStateRepository {
  if (_batchEvaluationRunStateRepository === null) {
    const clickHouseClient = getClickHouseClient();
    _batchEvaluationRunStateRepository = clickHouseClient
      ? new BatchEvaluationRunStateRepositoryClickHouse(clickHouseClient)
      : new BatchEvaluationRunStateRepositoryMemory();
  }
  return _batchEvaluationRunStateRepository;
}
