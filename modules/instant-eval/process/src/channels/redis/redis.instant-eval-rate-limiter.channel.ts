/**
 * How many input tokens this deployment may send the judge per second, and
 * one tenant's share of that. The bucket lives in Redis because the quota is
 * the key's, not a pod's. @see specs/instant-evals/classifier.feature
 */

import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type {
  InstantEvalPermit,
  InstantEvalRateLimiterChannel,
} from "../instant-eval-judge.channel.ts";

const logger = createLogger("langwatch:instant-evals:rate-limiter");

/**
 * The braces are a Redis Cluster hash tag: the script takes from both buckets
 * in one EVAL, which a cluster only allows when every key hashes to one slot.
 */
const BUCKET_KEY_PREFIX = "langwatch:{instant-evals:classifier-tokens}";

const GLOBAL_BUCKET_KEY = BUCKET_KEY_PREFIX;

function tenantBucketKey(tenantId: string): string {
  return `${BUCKET_KEY_PREFIX}:tenant:${tenantId}`;
}

/** Long enough that an idle bucket survives a quiet hour. */
const BUCKET_TTL_MS = 3_600_000;

/**
 * Input tokens a second a pod allows itself when Redis cannot be reached: a
 * fifth of the default global rate, safe to multiply by a handful of pods.
 */
export const LOCAL_FALLBACK_TOKENS_PER_SECOND = 60_000;

/** Never sleep longer than this in one go, so a cancelled query notices. */
const MAX_SLEEP_MS = 250;

/**
 * Longest one classification waits for capacity before it is let through to
 * be paced by the judge's own 429: a permit nobody can grant is a query that
 * has already failed, and waiting forever hides that from every caller.
 */
const MAX_WAIT_MS = 120_000;

/** The Redis surface this channel uses, structurally. */
export type InstantEvalRateLimiterRedis = {
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
};

/**
 * Refills both buckets and takes from both, or from neither. The clock is an
 * argument: `redis.call('TIME')` is refused in a replicated script.
 */
const TAKE_TOKENS_SCRIPT = `
local now = tonumber(ARGV[1])
local wanted = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local global_capacity = tonumber(ARGV[4])
local global_refill = tonumber(ARGV[5])
local tenant_capacity = tonumber(ARGV[6])
local tenant_refill = tonumber(ARGV[7])

local function refilled(key, capacity, refill)
  local state = redis.call('HMGET', key, 'tokens', 'at')
  local tokens = tonumber(state[1])
  local at = tonumber(state[2])
  if tokens == nil or at == nil then
    tokens = capacity
    at = now
  end
  local elapsed = math.max(0, now - at) / 1000
  return math.min(capacity, tokens + elapsed * refill)
end

local function wait_for(tokens, refill)
  if tokens >= wanted then return 0 end
  return math.ceil(((wanted - tokens) / refill) * 1000)
end

local global_tokens = refilled(KEYS[1], global_capacity, global_refill)
local tenant_tokens = refilled(KEYS[2], tenant_capacity, tenant_refill)

local wait = math.max(
  wait_for(global_tokens, global_refill),
  wait_for(tenant_tokens, tenant_refill)
)
local granted = 0
if wait == 0 then
  granted = wanted
  global_tokens = global_tokens - wanted
  tenant_tokens = tenant_tokens - wanted
end

redis.call('HSET', KEYS[1], 'tokens', global_tokens, 'at', now)
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('HSET', KEYS[2], 'tokens', tenant_tokens, 'at', now)
redis.call('PEXPIRE', KEYS[2], ttl)
return {granted, wait}
`;

export interface RedisInstantEvalRateLimiterOptions {
  /** The process's Redis connection, or `null` to run on the local fallback. */
  readonly redis: InstantEvalRateLimiterRedis | null;
  /** Input tokens a second the whole deployment may send. */
  readonly tokensPerSecond: number;
  /** Burst the global bucket may hold, above the rate so clock skew cannot stall it. */
  readonly capacity: number;
  readonly tenantTokensPerSecond: number;
  readonly tenantCapacity: number;
  /** Injected so a suite can drive the bucket without sleeping. */
  readonly now?: () => Instant;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class RedisInstantEvalRateLimiterChannel implements InstantEvalRateLimiterChannel {
  private localTokens: number;
  private localAt: number;
  private readonly now: () => Instant;
  private readonly sleep: (ms: number) => Promise<void>;

  private constructor(private readonly options: RedisInstantEvalRateLimiterOptions) {
    this.now = options.now ?? nowInstant;
    this.sleep = options.sleep ?? defaultSleep;
    this.localTokens = LOCAL_FALLBACK_TOKENS_PER_SECOND;
    this.localAt = this.now().epochMilliseconds;
  }

  static create(options: RedisInstantEvalRateLimiterOptions): RedisInstantEvalRateLimiterChannel {
    return new RedisInstantEvalRateLimiterChannel(options);
  }

  async acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void> {
    // Never more than the bucket can hold, or the request waits forever for a
    // fill that never comes; a request past the capacity is one the judge
    // would refuse anyway, so it is let through to be refused.
    const wanted = Math.max(
      1,
      Math.min(Math.ceil(permit.tokens), this.options.capacity, this.options.tenantCapacity),
    );
    const deadline = this.now().epochMilliseconds + MAX_WAIT_MS;
    while (this.now().epochMilliseconds < deadline) {
      signal?.throwIfAborted();
      const waitMs = await this.draw({ wanted, tenantId: permit.tenantId });
      if (waitMs === 0) return;
      await this.sleep(Math.min(waitMs, MAX_SLEEP_MS));
    }
  }

  /** Takes the tokens, or answers with how long the buckets need. */
  private async draw({ wanted, tenantId }: { wanted: number; tenantId: string }): Promise<number> {
    const { redis } = this.options;
    if (!redis) return this.drawLocally(wanted);
    try {
      return this.takeFromBuckets({ redis, wanted, tenantId });
    } catch (error) {
      logger.warn(
        { error },
        "Instant Evals rate limiter could not reach Redis; falling back to the local rate",
      );
      return this.drawLocally(wanted);
    }
  }

  private async takeFromBuckets({
    redis,
    wanted,
    tenantId,
  }: {
    redis: InstantEvalRateLimiterRedis;
    wanted: number;
    tenantId: string;
  }): Promise<number> {
    const reply = await redis.eval(
      TAKE_TOKENS_SCRIPT,
      2,
      GLOBAL_BUCKET_KEY,
      tenantBucketKey(tenantId),
      String(this.now().epochMilliseconds),
      String(wanted),
      String(BUCKET_TTL_MS),
      String(this.options.capacity),
      String(this.options.tokensPerSecond),
      String(this.options.tenantCapacity),
      String(this.options.tenantTokensPerSecond),
    );
    const [granted, waitMs] = readReply(reply);
    // A reply that is not two numbers would become NaN, and a NaN wait is a
    // loop that never sleeps and never gives up; "come back in a moment" is
    // the safe reading of an answer we cannot parse.
    if (Number.isFinite(granted) && granted >= wanted) return 0;
    return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : MAX_SLEEP_MS;
  }

  /**
   * The pod's own bucket, refilled the same way as the shared one, so a Redis
   * outage is a slowdown rather than a different feature.
   */
  private drawLocally(wanted: number): number {
    const now = this.now().epochMilliseconds;
    const elapsedSeconds = Math.max(0, now - this.localAt) / 1000;
    this.localTokens = Math.min(
      LOCAL_FALLBACK_TOKENS_PER_SECOND,
      this.localTokens + elapsedSeconds * LOCAL_FALLBACK_TOKENS_PER_SECOND,
    );
    this.localAt = now;
    const needed = Math.min(wanted, LOCAL_FALLBACK_TOKENS_PER_SECOND);
    if (this.localTokens >= needed) {
      this.localTokens -= needed;
      return 0;
    }
    return Math.ceil(((needed - this.localTokens) / LOCAL_FALLBACK_TOKENS_PER_SECOND) * 1000);
  }
}

/** The script's two numbers, or two NaNs when the reply is not that shape. */
function readReply(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length < 2) return [Number.NaN, Number.NaN];
  return [Number(reply[0]), Number(reply[1])];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
