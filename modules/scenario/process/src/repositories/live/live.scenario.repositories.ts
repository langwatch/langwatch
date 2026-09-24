import type { ProcessMembers } from "@langwatch/process-stores/members";

import { PostgresScenarioRepositories } from "../prisma/prisma.scenario.repositories.ts";
import {
  DuplicatedCancellationConnection,
  RedisCancellationPublisherAdapter,
  RedisCancellationSubscriberAdapter,
} from "../redis/redis.cancellation-channel.repository.ts";
import { RedisSimulationRunProcessingRepository } from "../redis/redis.simulation-run-processing.repository.ts";
import type { ScenarioRepositories } from "../scenario.repositories.ts";

/** Scenario's live stores: the aggregate in Postgres, runs in ClickHouse behind Redis. */
export class LiveScenarioRepositories {
  static readonly requires = ["prisma", "clickhouse", "redis"] as const;

  static create({
    prisma,
    clickhouse,
    redis,
  }: Pick<ProcessMembers, "prisma" | "clickhouse" | "redis">): ScenarioRepositories {
    return {
      ...PostgresScenarioRepositories.create({ prisma }),
      simulationRunProcessing: RedisSimulationRunProcessingRepository.create({ clickhouse, redis }),
      cancellations: RedisCancellationPublisherAdapter.create(redis),
      cancellationSubscriptions: RedisCancellationSubscriberAdapter.create(
        DuplicatedCancellationConnection.over(redis),
      ),
    };
  }
}
