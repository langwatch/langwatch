import type { RedisConnection } from "@langwatch/redis-client";

import { MemoryBroadcastTenantRateLimiterRepository } from "../memory/memory.broadcast-tenant-rate-limiter.repository.ts";
import type { PresenceRepositories } from "../presence.repositories.ts";
import { PostgresPresenceRepositories } from "../prisma/prisma.presence.repositories.ts";
import { RedisBroadcastRepository } from "../redis/redis.broadcast.repository.ts";
import { RedisPresenceRepository } from "../redis/redis.presence.repository.ts";

/** Presence's live stores: sessions and broadcast in Redis, the owners' settings in Postgres. */
export class LivePresenceRepositories {
  static readonly requires = ["prisma", "redis"] as const;

  static create({
    prisma,
    redis,
  }: Readonly<{
    prisma: Parameters<typeof PostgresPresenceRepositories.create>[0]["prisma"];
    redis: RedisConnection;
  }>): PresenceRepositories {
    return {
      ...PostgresPresenceRepositories.create({ prisma }),
      sessions: RedisPresenceRepository.create(redis),
      broadcast: RedisBroadcastRepository.create(redis, {
        sender: MemoryBroadcastTenantRateLimiterRepository.create(),
        subscriber: MemoryBroadcastTenantRateLimiterRepository.create(),
      }),
    };
  }
}
