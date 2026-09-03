import type { RedisConnection } from "@langwatch/redis-client";

/** The verdict one fixed window answers with. */
export interface ApiRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** What one caller is counted against, and for how long. */
export interface ApiRateLimitRequest {
  key: string;
  windowSeconds: number;
  max: number;
}

/**
 * Where the limiter finds the process's Redis at the moment it counts.
 *
 * A function rather than a connection so the queue infrastructure stays the
 * one owner of the client: the limiter reads whatever that composed, and
 * answers from memory when it composed nothing. Resolving it per call rather
 * than at construction is what lets a process compose its limiter before its
 * Redis, and it is the injected form of the lazy lookup the platform's
 * implementation does through the global application container.
 */
export type ApiRateLimitConnectionPort = () => RedisConnection | undefined;

/** The key space the counters share with every other process in the deployment. */
const REDIS_KEY_PREFIX = "langwatch:ratelimit:";

/**
 * The in-memory fallback's sweep threshold.
 *
 * The naive store only frees an entry when the same key is asked for again
 * after its window closed, so a stream of distinct keys — one per address, say
 * — grows without bound. Crossing this many retained windows sweeps the
 * expired ones. A deployment with Redis never reaches this code.
 */
const MEMORY_GC_THRESHOLD = 1000;

interface RetainedWindow {
  count: number;
  expiresAt: number;
}

/**
 * Per-key fixed-window rate limiting, owned by the API process.
 *
 * Redis when the process composed one, an in-process map otherwise — the same
 * two paths, the same window arithmetic and the same degradation as the
 * platform implementation this replaces, with the one difference that matters
 * here: the connection is injected rather than recovered from a global
 * application container, and the retained windows belong to an instance rather
 * than to a module.
 *
 * The window is a fixed approximation of a sliding one, deliberately: it costs
 * one Redis round trip per request, and the accuracy it gives up is a caller
 * who spends a whole window's allowance at its very end and another at the
 * start of the next.
 *
 * Redis failures are NOT caught. A counter that cannot count is not a request
 * that may proceed unlimited, and the boundary's error handler already renders
 * the refusal; swallowing it here would fail the limit open without saying so.
 */
export class ApiRateLimitInfrastructure {
  static create(
    options: { connection?: ApiRateLimitConnectionPort } = {},
  ): ApiRateLimitInfrastructure {
    return new ApiRateLimitInfrastructure(options.connection);
  }

  private readonly windows = new Map<string, RetainedWindow>();

  private constructor(private readonly connection: ApiRateLimitConnectionPort | undefined) {}

  /** Counts one hit against `key`'s window and answers whether it is allowed. */
  async consume({ key, windowSeconds, max }: ApiRateLimitRequest): Promise<ApiRateLimitResult> {
    const now = Date.now();
    const redis = this.connection?.();
    if (redis) {
      return this.consumeInRedis({ redis, key, windowSeconds, max, now });
    }
    return this.consumeInMemory({ key, windowSeconds, max, now });
  }

  /**
   * How many windows the in-memory fallback is holding.
   *
   * The Redis path retains none, so this is the only number in the limiter
   * that can grow, and it is what {@link MEMORY_GC_THRESHOLD} bounds.
   */
  retainedWindows(): number {
    return this.windows.size;
  }

  /**
   * The TTL is read back rather than assumed: the window may have been opened
   * by another process, and a key whose expiry was somehow lost still answers
   * with a reset one full window out instead of one in the past.
   */
  private async consumeInRedis(options: {
    redis: RedisConnection;
    key: string;
    windowSeconds: number;
    max: number;
    now: number;
  }): Promise<ApiRateLimitResult> {
    const { redis, windowSeconds, max, now } = options;
    const redisKey = `${REDIS_KEY_PREFIX}${options.key}`;
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    const ttl = await redis.ttl(redisKey);
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: now + (ttl > 0 ? ttl : windowSeconds) * 1000,
    };
  }

  private consumeInMemory(options: {
    key: string;
    windowSeconds: number;
    max: number;
    now: number;
  }): ApiRateLimitResult {
    const { key, windowSeconds, max, now } = options;
    this.sweepExpiredWindows(now);

    const retained = this.windows.get(key);
    if (!retained || retained.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      this.windows.set(key, { count: 1, expiresAt });
      return { allowed: max >= 1, remaining: max - 1, resetAt: expiresAt };
    }

    retained.count += 1;
    return {
      allowed: retained.count <= max,
      remaining: Math.max(0, max - retained.count),
      resetAt: retained.expiresAt,
    };
  }

  private sweepExpiredWindows(now: number): void {
    if (this.windows.size < MEMORY_GC_THRESHOLD) return;
    for (const [key, retained] of this.windows) {
      if (retained.expiresAt <= now) this.windows.delete(key);
    }
  }
}
