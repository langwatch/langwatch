import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Cluster, Redis } from "ioredis";

import {
  ClickHouseCodingAgentRepositories,
  type CodingAgentProcessClock,
  type CodingAgentProcessTelemetry,
} from "../clickhouse/clickhouse.coding-agent.repositories.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { RedisCodingAgentSessionFoldCacheRepository } from "../redis/redis.coding-agent-session-fold-cache.repository.ts";
import { RedisSessionContextMemoRepository } from "../redis/redis.session-context-memo.repository.ts";

/** Coding agent's live stores: session projections in ClickHouse, the fold's scratch in Redis. */
export class LiveCodingAgentRepositories {
  static readonly requires = ["clickhouse", "clock", "telemetry", "redis"] as const;

  static create({
    clickhouse,
    clock,
    telemetry,
    redis,
  }: {
    clickhouse: ClickHouseQueryClient;
    clock: CodingAgentProcessClock;
    telemetry: CodingAgentProcessTelemetry;
    redis: Redis | Cluster;
  }): CodingAgentRepositories {
    return {
      ...ClickHouseCodingAgentRepositories.create({ clickhouse, clock, telemetry }),
      sessionContextMemo: RedisSessionContextMemoRepository.create(redis),
      sessionFoldCache: RedisCodingAgentSessionFoldCacheRepository.create(redis),
    };
  }
}
