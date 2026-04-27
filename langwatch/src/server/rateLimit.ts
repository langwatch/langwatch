import { connection as redisConnection } from "./redis";

/**
 * Per-key sliding-window rate limiter. Uses Redis when available
 * (production / Redis-backed dev), in-memory otherwise (unit tests,
 * SKIP_REDIS=1, dev without Redis).
 *
 * Used by tRPC mutations that aren't protected by BetterAuth's own
 * rate limit (e.g. `user.register`, which writes to the DB directly
 * instead of routing through `/api/auth/sign-up/email` and therefore
 * skips BetterAuth's `/sign-up/email` 20-per-hour limit). Without
 * this helper, an unauthenticated attacker can spam-create users
 * from any IP — see iter 45 of the BetterAuth migration audit.
 *
 * The fixed-window approximation here is intentional: a slight
 * accuracy tradeoff for a single Redis round-trip per request.
 * Returns `{ allowed, remaining, resetAt }`.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

/**
 * Opportunistic garbage collection for the in-memory store. The naive
 * implementation only frees an entry when the same key is hit again
 * after expiry, so a sustained stream of distinct keys (e.g., one
 * per IP) leaks unbounded. This sweep walks the map every time it
 * crosses MEMORY_GC_THRESHOLD entries and drops anything expired.
 * Production paths use Redis and never reach this code; the GC is
 * dev/test hygiene.
 */
const MEMORY_GC_THRESHOLD = 1000;
function sweepExpiredMemoryEntries(now: number): void {
  if (memoryStore.size < MEMORY_GC_THRESHOLD) return;
  for (const [k, v] of memoryStore) {
    if (v.expiresAt <= now) memoryStore.delete(k);
  }
}

export async function rateLimit(opts: {
  key: string;
  windowSeconds: number;
  max: number;
}): Promise<RateLimitResult> {
  const { key, windowSeconds, max } = opts;
  const now = Date.now();

  if (redisConnection) {
    const redisKey = `langwatch:ratelimit:${key}`;
    const count = await redisConnection.incr(redisKey);
    if (count === 1) {
      await redisConnection.expire(redisKey, windowSeconds);
    }
    const ttl = await redisConnection.ttl(redisKey);
    const resetAt = now + (ttl > 0 ? ttl : windowSeconds) * 1000;
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt,
    };
  }

  sweepExpiredMemoryEntries(now);

  const existing = memoryStore.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryStore.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return { allowed: 1 <= max, remaining: max - 1, resetAt: now + windowSeconds * 1000 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= max,
    remaining: Math.max(0, max - existing.count),
    resetAt: existing.expiresAt,
  };
}

/** Test-only: clear in-memory state. No-op for Redis. */
export function _resetMemoryRateLimitStore(): void {
  memoryStore.clear();
}

/** Test-only: inspect in-memory store size for GC verification. */
export function _getMemoryStoreSize(): number {
  return memoryStore.size;
}
