import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { Cluster, Redis } from "ioredis";

import { ClickHouseCodingAgentRepositories } from "../clickhouse/clickhouse.coding-agent.repositories.ts";
import type { CodingAgentRepositories } from "../coding-agent.repositories.ts";
import { RedisCodingAgentSessionFoldCacheRepository } from "../redis/redis.coding-agent-session-fold-cache.repository.ts";
import { RedisSessionContextMemoRepository } from "../redis/redis.session-context-memo.repository.ts";

/** Coding agent's live stores: session projections in ClickHouse, the fold's scratch in Redis. */
export class LiveCodingAgentRepositories {
  static readonly requires = ["clickhouse", "redis"] as const;

  static create({
    clickhouse,
    redis,
  }: {
    clickhouse: ClickHouseQueryClient;
    redis: Redis | Cluster;
  }): CodingAgentRepositories {
    return {
      ...ClickHouseCodingAgentRepositories.create({ clickhouse }),
      sessionContextMemo: RedisSessionContextMemoRepository.create(redis),
      sessionFoldCache: RedisCodingAgentSessionFoldCacheRepository.create(redis),
    };
  }
}
