export { ExperimentRunStateRepositoryClickHouse } from "./experimentRunState.clickhouse.repository";
export { ExperimentRunStateRepositoryMemory } from "./experimentRunState.memory.repository";
export type { ExperimentRunStateRepository } from "./experimentRunState.repository";

import { getClickHouseClient } from "~/server/clickhouse/client";
import { ExperimentRunStateRepositoryClickHouse } from "./experimentRunState.clickhouse.repository";
import { ExperimentRunStateRepositoryMemory } from "./experimentRunState.memory.repository";
import type { ExperimentRunStateRepository } from "./experimentRunState.repository";

let _experimentRunStateRepository: ExperimentRunStateRepository | null = null;

export function getExperimentRunStateRepository(): ExperimentRunStateRepository {
  if (_experimentRunStateRepository === null) {
    const clickHouseClient = getClickHouseClient();
    _experimentRunStateRepository = clickHouseClient
      ? new ExperimentRunStateRepositoryClickHouse(clickHouseClient)
      : new ExperimentRunStateRepositoryMemory();
  }
  return _experimentRunStateRepository;
}
