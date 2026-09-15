import type { RedisConnection } from "@langwatch/redis-client";
import type { Cache, IdempotencyStore, RateLimiter } from "./members.ts";

const CACHE_PREFIX = "member:cache:";
const TAG_PREFIX = "member:cache-tag:";
const IDEMPOTENCY_PREFIX = "member:idempotency:";
const RATE_LIMIT_PREFIX = "member:rate-limit:";

/**
 * Response bodies, with one Redis set per tag so a family drops everything it
 * wrote in one call. The tag set outlives its entries, so an invalidation of a
 * tag whose entries have expired is a no-op rather than an error.
 */
export function redisCache(redis: RedisConnection): Cache {
  return {
    async find(key) {
      const stored = await redis.getBuffer(`${CACHE_PREFIX}${key}`);
      return stored === null ? void 0 : new Uint8Array(stored);
    },
    async set(key, tag, body, ttlSeconds) {
      const entry = `${CACHE_PREFIX}${key}`;
      await redis.set(entry, Buffer.from(body), "EX", ttlSeconds);
      await redis.sadd(`${TAG_PREFIX}${tag}`, entry);
    },
    async invalidateTag(tag) {
      const set = `${TAG_PREFIX}${tag}`;
      const entries = await redis.smembers(set);
      if (entries.length > 0) await redis.del(...entries);
      await redis.del(set);
    },
  };
}

/**
 * The first caller inside the window claims the key; every repeat reads it as
 * claimed. `SET NX` is the whole decision, so two processes racing on the same
 * key still answer once.
 */
export function redisIdempotency(redis: RedisConnection): IdempotencyStore {
  return {
    async claim(key, ttlSeconds) {
      const claimed = await redis.set(
        `${IDEMPOTENCY_PREFIX}${key}`,
        "claimed",
        "EX",
        ttlSeconds,
        "NX",
      );
      return claimed === "OK";
    },
  };
}

/**
 * A fixed window per key: the first request in a window sets the expiry, and
 * the one that crosses the allowance reads the remaining seconds back as its
 * retry-after.
 */
export function redisRateLimiter(
  redis: RedisConnection,
  window: Readonly<{ requests: number; seconds: number }>,
): RateLimiter {
  return {
    async check(key) {
      const counter = `${RATE_LIMIT_PREFIX}${key}`;
      const used = await redis.incr(counter);
      if (used === 1) await redis.expire(counter, window.seconds);
      if (used <= window.requests) return { allowed: true };

      const remaining = await redis.ttl(counter);
      return { allowed: false, retryAfterSeconds: remaining > 0 ? remaining : window.seconds };
    },
  };
}
