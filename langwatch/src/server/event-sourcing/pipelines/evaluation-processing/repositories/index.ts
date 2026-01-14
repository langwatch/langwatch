export type { EvaluationStateRepository } from "./evaluationStateRepository";
export { EvaluationStateRepositoryClickHouse } from "./evaluationStateRepositoryClickHouse";
export { EvaluationStateRepositoryMemory } from "./evaluationStateRepositoryMemory";

import { getClickHouseClient } from "~/server/clickhouse/client";
import type { EvaluationStateRepository } from "./evaluationStateRepository";
import { EvaluationStateRepositoryClickHouse } from "./evaluationStateRepositoryClickHouse";
import { EvaluationStateRepositoryMemory } from "./evaluationStateRepositoryMemory";

const clickHouseClient = getClickHouseClient();

export const evaluationStateRepository: EvaluationStateRepository =
  clickHouseClient
    ? new EvaluationStateRepositoryClickHouse(clickHouseClient)
    : new EvaluationStateRepositoryMemory();
