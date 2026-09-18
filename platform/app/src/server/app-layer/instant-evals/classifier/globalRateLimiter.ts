/**
 * The rate at which this whole deployment may ask the classifier anything.
 *
 * The quota being spent belongs to LangWatch's own key, not to a pod and not to
 * a project, so the limiter has to be shared: four pods each pacing themselves
 * at the published rate would send four times it. The bucket therefore lives in
 * Redis, and a permit is taken before every request.
 *
 * A token bucket rather than the fixed window in `~/server/rateLimit.ts`,
 * because the failure modes differ. A fixed window lets a burst through at the
 * boundary and then refuses everything, which for a query judging a thousand
 * rows means a thousand refusals arriving as skipped cells. A bucket hands
 * every waiting caller a time to come back at, so the query is slower rather
 * than wrong.
 *
 * Three details that are decisions rather than details:
 *
 *  - **Permits are drawn in chunks.** A round trip to Redis per classification
 *    would add its own latency to a call that takes 250 ms, so a caller asking
 *    for one permit takes a chunk and spends the rest locally. The cost is that
 *    a pod can hold up to a chunk of unspent permits when it stops, which the
 *    bucket refills past in under a tenth of a second.
 *  - **The clock is the caller's.** `redis.call('TIME')` is not allowed in a
 *    replicated script, so the current time is an argument. Two pods with
 *    skewed clocks can each refill slightly early, which is bounded by the
 *    skew and is the reason capacity sits above the per-second rate.
 *  - **Redis being down does not stop a query.** It falls back to a local rate
 *    far below the global one: slower than the real limit and safe to multiply
 *    by however many pods are running.
 *
 * @see ./classifier.ts
 * @see ../../../../../specs/instant-evals/classifier.feature
 */

import { createLogger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";

const logger = createLogger("langwatch:instant-evals:rate-limiter");

/** One bucket for the whole deployment. */
const BUCKET_KEY = "langwatch:instant-evals:classifier-rate";

/** Long enough that an idle bucket survives a quiet hour, short enough to expire. */
const BUCKET_TTL_MS = 3_600_000;

/** How many permits one round trip to Redis draws. */
const PERMIT_CHUNK = 8;

/** Requests per second a pod allows itself when Redis cannot be reached. */
const LOCAL_FALLBACK_RPS = 20;

/** Never sleep longer than this in one go, so a cancelled query notices. */
const MAX_SLEEP_MS = 250;

/**
 * Take a permit, or wait for one.
 *
 * Deliberately one method: everything above this cares about being allowed to
 * send, not about how many tokens are left.
 */
export interface InstantEvalRateLimiter {
  acquire(signal?: AbortSignal): Promise<void>;
}

/**
 * Atomically refills the bucket and takes from it.
 *
 * Returns the permits granted and, when none were, how long to wait before the
 * bucket holds enough. One key, so nothing here depends on Redis Cluster slot
 * placement.
 */
const TAKE_PERMITS_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local wanted = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(state[1])
local at = tonumber(state[2])
if tokens == nil or at == nil then
  tokens = capacity
  at = now
end
local elapsed = math.max(0, now - at) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)
local granted = 0
local wait = 0
if tokens >= wanted then
  granted = wanted
  tokens = tokens - wanted
elseif tokens >= 1 then
  granted = math.floor(tokens)
  tokens = tokens - granted
else
  wait = math.ceil(((1 - tokens) / refill) * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'at', now)
redis.call('PEXPIRE', KEYS[1], ttl)
return {granted, wait}
`;

export interface InstantEvalRateLimiterOptions {
  /** The process's Redis connection, or `null` to run on the local fallback. */
  readonly redis: RedisConnection | null;
  /** Requests per second the deployment may send. */
  readonly requestsPerSecond: number;
  /** Burst the bucket may hold. Above the rate, so a skewed clock cannot stall it. */
  readonly capacity: number;
  /** Injected so a suite can drive the bucket without sleeping. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class RedisInstantEvalRateLimiter implements InstantEvalRateLimiter {
  private permitsInHand = 0;
  private localTokens: number;
  private localAt: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: InstantEvalRateLimiterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.localTokens = LOCAL_FALLBACK_RPS;
    this.localAt = this.now();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      if (this.permitsInHand > 0) {
        this.permitsInHand -= 1;
        return;
      }
      const waitMs = await this.draw();
      if (waitMs === 0) continue;
      await this.sleep(Math.min(waitMs, MAX_SLEEP_MS));
    }
  }

  /** Draws a chunk into hand, or answers with how long the bucket needs. */
  private async draw(): Promise<number> {
    const { redis } = this.options;
    if (!redis) return this.drawLocally();
    try {
      const granted = await this.takeFromBucket(redis);
      if (granted.permits > 0) {
        // Added, never assigned: two `acquire` calls can be awaiting their own
        // draw at once, Redis has already deducted both chunks, and assigning
        // would throw away whichever landed first.
        this.permitsInHand += granted.permits;
        return 0;
      }
      return granted.waitMs;
    } catch (error) {
      logger.warn(
        { error },
        "Instant Evals rate limiter could not reach Redis; falling back to the local rate",
      );
      return this.drawLocally();
    }
  }

  private async takeFromBucket(
    redis: RedisConnection,
  ): Promise<{ permits: number; waitMs: number }> {
    const reply = (await redis.eval(
      TAKE_PERMITS_SCRIPT,
      1,
      BUCKET_KEY,
      String(this.options.capacity),
      String(this.options.requestsPerSecond),
      String(this.now()),
      String(PERMIT_CHUNK),
      String(BUCKET_TTL_MS),
    )) as [number | string, number | string];
    const permits = Number(reply[0]);
    const waitMs = Number(reply[1]);
    // A reply that is not two numbers would otherwise become `NaN`, and a
    // `NaN` wait is a loop that never sleeps and never gives up. Treated as
    // "come back in a moment", which is the safe reading of an answer we
    // cannot parse.
    return {
      permits: Number.isFinite(permits) ? permits : 0,
      waitMs: Number.isFinite(waitMs) && waitMs > 0 ? waitMs : MAX_SLEEP_MS,
    };
  }

  /**
   * The pod's own bucket, at a rate low enough to be safe times any pod count.
   *
   * Refilled the same way as the shared one so the two behave alike, which is
   * what keeps a Redis outage a slowdown rather than a different feature.
   */
  private drawLocally(): number {
    const now = this.now();
    const elapsedSeconds = Math.max(0, now - this.localAt) / 1000;
    this.localTokens = Math.min(
      LOCAL_FALLBACK_RPS,
      this.localTokens + elapsedSeconds * LOCAL_FALLBACK_RPS,
    );
    this.localAt = now;
    if (this.localTokens >= 1) {
      this.localTokens -= 1;
      this.permitsInHand += 1;
      return 0;
    }
    return Math.ceil(((1 - this.localTokens) / LOCAL_FALLBACK_RPS) * 1000);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A limiter that never waits, for the null classifier and for suites. */
export class UnlimitedInstantEvalRateLimiter implements InstantEvalRateLimiter {
  async acquire(): Promise<void> {
    // Nothing is sent, so nothing has to be paced.
  }
}
