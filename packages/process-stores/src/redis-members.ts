import { counter } from "@langwatch/observability/metrics";
import type { RedisConnection } from "@langwatch/redis-client";

import type { Cache, IdempotencyStore, RateLimiter } from "./members.ts";

const CACHE_PREFIX = "member:cache:";
const TAG_PREFIX = "member:cache-tag:";
const IDEMPOTENCY_PREFIX = "member:idempotency:";
const RATE_LIMIT_PREFIX = "member:rate-limit:";

/** Denied checks by calling scope, under main's metric name and label. */
const rateLimitExceeded = counter({
  name: "rate_limit_exceeded_total",
  description:
    "Rate-limit checks that returned allowed: false, by the calling scope (the key segment before its first ':')",
});

/** The key segment before its first ":", so the label never carries an address or hash. */
function scopeOf(key: string): string {
  const separator = key.indexOf(":");
  return separator === -1 ? key : key.slice(0, separator);
}

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
    async set({ key, tag, body, ttlSeconds }) {
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
 * One script, so no counter is ever left without its window's expiry (a lockout that never
 * lifts).
 */
const COUNT_IN_WINDOW = `
local used = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return used`;

/**
 * A fixed window per key: the first request sets the expiry, the one crossing
 * the allowance reads the remaining seconds as its retry-after, and a caller
 * naming its own window counts against it instead of the constructed one.
 */
export function redisRateLimiter(
  redis: RedisConnection,
  window: Readonly<{ requests: number; seconds: number }>,
): RateLimiter {
  return {
    async check(key, limit) {
      const allowance = limit ?? window;
      const counter = `${RATE_LIMIT_PREFIX}${key}`;
      const used = Number(await redis.eval(COUNT_IN_WINDOW, 1, counter, allowance.seconds));
      if (used <= allowance.requests) return { allowed: true };

      rateLimitExceeded.inc({ scope: scopeOf(key) });
      const remaining = await redis.ttl(counter);
      return { allowed: false, retryAfterSeconds: remaining > 0 ? remaining : allowance.seconds };
    },
  };
}
