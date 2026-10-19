import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import { MemoryRumRateLimitRepository } from "../memory/memory.rum-rate-limit.repository.ts";
import type {
  RumRateLimitRepository,
  RumRateLimitResult,
  RumRateLimitWindow,
} from "../rum-rate-limit.repository.ts";

type RateLimitConnection = Pick<RedisConnection, "incr" | "expire" | "ttl">;

/**
 * The door's buckets in Redis under main's key prefix. Redis makes the budget
 * process-wide; it is not an availability dependency, so a failed command
 * counts in this process instead, as main's limiter did (ADR-093).
 */
export class RedisRumRateLimitRepository implements RumRateLimitRepository {
  readonly #connection: RateLimitConnection;
  readonly #fallback: MemoryRumRateLimitRepository;

  private constructor(connection: RateLimitConnection, fallback: MemoryRumRateLimitRepository) {
    this.#connection = connection;
    this.#fallback = fallback;
  }

  static create({ connection }: { connection: RateLimitConnection }): RedisRumRateLimitRepository {
    return new RedisRumRateLimitRepository(connection, MemoryRumRateLimitRepository.create());
  }

  async limit(window: RumRateLimitWindow): Promise<RumRateLimitResult> {
    const redisKey = `langwatch:ratelimit:${window.key}`;
    try {
      const count = await this.#connection.incr(redisKey);
      if (count === 1) await this.#connection.expire(redisKey, window.windowSeconds);
      const ttl = await this.#connection.ttl(redisKey);
      return {
        allowed: count <= window.max,
        remaining: Math.max(0, window.max - count),
        resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : window.windowSeconds) * 1000,
      };
    } catch {
      return this.#fallback.limit(window);
    }
  }
}
