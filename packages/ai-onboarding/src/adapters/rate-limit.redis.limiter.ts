import type { RateLimitDecision, RateLimiter } from "../app/ports.js";
import { KEY_PREFIX, type RedisLike } from "./redis.js";

/**
 * Fixed-window counter in Redis — one INCR per request, with the window's TTL
 * set on the first hit.
 *
 * The fixed window is an approximation (a caller can spend two windows' budget
 * across a boundary). That is the same tradeoff `src/server/rateLimit.ts`
 * makes, and it is the right one here: the axes stack, so a boundary burst
 * still has to clear the fingerprint, subnet and global buckets too.
 *
 * Throws when Redis is unreachable rather than allowing the request. Whether
 * that means "refuse" or "serve anyway" is the guard's decision, per axis —
 * not something an adapter should be quietly choosing.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: RedisLike) {}

  async consume(params: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<RateLimitDecision> {
    const key = `${KEY_PREFIX}:rl:${params.key}`;

    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, params.windowSeconds);
    }

    if (count <= params.max) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const ttl = await this.redis.ttl(key);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : params.windowSeconds,
    };
  }
}
