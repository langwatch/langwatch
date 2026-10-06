import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { RateLimiter } from "@langwatch/process-stores";
import type { RedisConnection } from "@langwatch/redis-client";

import type { ScenarioSecretCipher } from "../../app/scenario.app.ts";
import { ResultAtomsClickHouseRepository } from "../clickhouse/clickhouse.result-atoms.repository.ts";
import { RunConfigurationsClickHouseRepository } from "../clickhouse/clickhouse.run-configurations.repository.ts";
import { ClickHouseScenarioSession } from "../clickhouse/clickhouse.scenario-session.store.ts";
import { ClickHouseSimulationSession } from "../clickhouse/clickhouse.simulation-session.store.ts";
import { ClickHouseStalledSimulationRunRepository } from "../clickhouse/clickhouse.stalled-simulation-run.repository.ts";
import { SimulationClickHouseRepository } from "../clickhouse/simulation-clickhouse.repository.ts";
import { PostgresScenarioRepositories } from "../prisma/prisma.scenario.repositories.ts";
import { RedisScenarioCancellationRepository } from "../redis/redis.scenario-cancellation.repository.ts";
import { RedisScenarioRateLimitRepository } from "../redis/redis.scenario-rate-limit.repository.ts";
import { RedisScenarioTabStoreRepository } from "../redis/redis.scenario-tab-store.repository.ts";
import { RedisSimulationRunProcessingRepository } from "../redis/redis.simulation-run-processing.repository.ts";
import { RedisVoiceNonceRepository } from "../redis/redis.voice-nonce.repository.ts";
import type { ScenarioRepositories } from "../scenario.repositories.ts";

/** Scenario's live stores: the aggregate in Postgres, runs in ClickHouse behind Redis. */
export class LiveScenarioRepositories {
  static readonly requires = [
    "prisma",
    "clickhouse",
    "redis",
    "rateLimiter",
    "encryption",
  ] as const;

  static create({
    prisma,
    clickhouse,
    redis,
    rateLimiter,
    encryption,
  }: Readonly<{
    prisma: Parameters<typeof PostgresScenarioRepositories.create>[0]["prisma"];
    clickhouse: ClickHouseQueryClient;
    redis: RedisConnection;
    rateLimiter: RateLimiter;
    encryption: ScenarioSecretCipher;
  }>): ScenarioRepositories {
    const sessions = ClickHouseSimulationSession.resolver(clickhouse);
    return {
      ...PostgresScenarioRepositories.create({ prisma, encryption }),
      simulationRunProcessing: RedisSimulationRunProcessingRepository.create({ clickhouse, redis }),
      stalledRuns: ClickHouseStalledSimulationRunRepository.create(clickhouse),
      tabs: RedisScenarioTabStoreRepository.create(redis),
      resultAtoms: ResultAtomsClickHouseRepository.create(sessions),
      runConfigurations: RunConfigurationsClickHouseRepository.create(sessions),
      voiceNonces: RedisVoiceNonceRepository.create(redis),
      simulations: SimulationClickHouseRepository.create(
        ClickHouseScenarioSession.resolverOver(clickhouse),
      ),
      rateLimits: RedisScenarioRateLimitRepository.create(rateLimiter),
      cancellations: RedisScenarioCancellationRepository.create(redis),
    };
  }
}
