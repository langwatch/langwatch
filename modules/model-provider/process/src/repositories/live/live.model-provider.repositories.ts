import type { RedisConnection } from "@langwatch/redis-client";

import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { PostgresModelProviderRepositories } from "../prisma/prisma.model-provider.repositories.ts";
import { RedisModelProviderRateLimitRepository } from "../redis/redis.model-provider-rate-limit.repository.ts";

/** Model Provider's live stores: rows in Postgres, sealed by the cipher; windows in Redis. */
export class LiveModelProviderRepositories {
  static readonly requires = ["prisma", "encryption", "redis"] as const;

  static create({
    prisma,
    encryption,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresModelProviderRepositories.create>[0]["prisma"];
    encryption: Parameters<typeof PostgresModelProviderRepositories.create>[0]["encryption"];
    redis: RedisConnection;
  }>): ModelProviderRepositories {
    return {
      ...PostgresModelProviderRepositories.create({ prisma, encryption }),
      rateLimits: RedisModelProviderRateLimitRepository.create(redis),
    };
  }
}
