import type { RedisConnection } from "@langwatch/redis-client";

import type { RumRepositories } from "../rum.repositories.ts";
import { RedisRumRateLimitRepository } from "./redis.rum-rate-limit.repository.ts";

export class RedisRumRepositories {
  static readonly requires = ["redis"] as const;

  static create(members: { redis: RedisConnection }): RumRepositories {
    return { rateLimits: RedisRumRateLimitRepository.create({ connection: members.redis }) };
  }
}
