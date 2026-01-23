export { EvaluationStateRepositoryClickHouse } from "./evaluationState.clickhouse.repository";
export { EvaluationStateRepositoryMemory } from "./evaluationState.memory.repository";
export type { EvaluationStateRepository } from "./evaluationState.repository";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { EvaluationStateRepositoryClickHouse } from "./evaluationState.clickhouse.repository";
import { EvaluationStateRepositoryMemory } from "./evaluationState.memory.repository";
import type { EvaluationStateRepository } from "./evaluationState.repository";

const clickHouseClient = getClickHouseClient();

export const evaluationStateRepository: EvaluationStateRepository =
  clickHouseClient
    ? new EvaluationStateRepositoryClickHouse(clickHouseClient)
    : new EvaluationStateRepositoryMemory();
