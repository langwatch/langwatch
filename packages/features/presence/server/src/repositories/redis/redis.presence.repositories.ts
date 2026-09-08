import type { RedisConnection } from "@langwatch/redis-client";
import type { PresenceRepositories } from "../presence.repositories.ts";
import { RedisPresenceRepository } from "./redis.presence.repository.ts";

export class RedisPresenceRepositories {
  static readonly requires = ["redis"] as const;

  static create(infrastructure: { redis: RedisConnection }): PresenceRepositories {
    return { sessions: RedisPresenceRepository.create(infrastructure.redis) };
  }
}
