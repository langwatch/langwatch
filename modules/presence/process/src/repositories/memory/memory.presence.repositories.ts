import type { PresenceRepositories } from "../presence.repositories.ts";
import { RedisBroadcastRepository } from "../redis/redis.broadcast.repository.ts";
import { MemoryBroadcastTenantRateLimiterRepository } from "./memory.broadcast-tenant-rate-limiter.repository.ts";
import { MemoryPresenceSettingsRepository } from "./memory.presence-settings.repository.ts";
import { MemoryPresenceRepository } from "./memory.presence.repository.ts";

export class MemoryPresenceRepositories {
  static readonly requires = [] as const;

  static create(): PresenceRepositories {
    return {
      sessions: MemoryPresenceRepository.create(),
      settings: MemoryPresenceSettingsRepository.create(),
      broadcast: RedisBroadcastRepository.create(null, {
        sender: MemoryBroadcastTenantRateLimiterRepository.create(),
        subscriber: MemoryBroadcastTenantRateLimiterRepository.create(),
      }),
    };
  }
}
