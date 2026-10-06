import type { RedisConnection } from "@langwatch/redis-client";

import { MemoryBroadcastTenantRateLimiterRepository } from "../memory/memory.broadcast-tenant-rate-limiter.repository.ts";
import type { PresenceRepositories } from "../presence.repositories.ts";
import { RedisBroadcastRepository } from "./redis.broadcast.repository.ts";
import { RedisPresenceSettingsRepository } from "./redis.presence-settings.repository.ts";
import { RedisPresenceRepository } from "./redis.presence.repository.ts";

export class RedisPresenceRepositories {
  static readonly requires = ["redis"] as const;

  static create(members: { redis: RedisConnection }): PresenceRepositories {
    return {
      sessions: RedisPresenceRepository.create(members.redis),
      settings: RedisPresenceSettingsRepository.create(members.redis),
      broadcast: RedisBroadcastRepository.create(members.redis, {
        sender: MemoryBroadcastTenantRateLimiterRepository.create(),
        subscriber: MemoryBroadcastTenantRateLimiterRepository.create(),
      }),
    };
  }
}
