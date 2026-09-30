/**
 * How many input tokens this whole deployment may send the classifier per
 * second, and how much of that one tenant may take.
 *
 * The classifier's ceiling is token-bound, not request-bound: measured against
 * the live API in September 2026 it sustains about 315k input tokens a second
 * whether that is five hundred small conversations or ten large ones. A bucket
 * of requests would either refuse small texts long before the ceiling or let
 * large ones sail past it, so the bucket holds tokens and every classification
 * takes its estimated input tokens, text plus questions, the same estimate the
 * token budget sizes a request with.
 *
 * The quota being spent belongs to LangWatch's own key, not to a pod and not to
 * a project, so the bucket has to be shared: four pods each pacing themselves
 * at the published rate would send four times it. It therefore lives in Redis,
 * and a permit is taken before every request.
 *
 * A token bucket rather than the fixed window in `~/server/rateLimit.ts`,
 * because the failure modes differ. A fixed window lets a burst through at the
 * boundary and then refuses everything, which for a query judging a thousand
 * rows means a thousand refusals arriving as skipped cells. A bucket hands
 * every waiting caller a time to come back at, so the query is slower rather
 * than wrong.
 *
 * Two buckets, one script:
 *
 *  - **The global bucket** is the deployment's ceiling.
 *  - **The tenant bucket** is one project's share of it. Without it, one
 *    hundred-thousand-row run would hold the global bucket empty for the
 *    seventeen minutes it takes, and every other project's synchronous query
 *    would queue behind it. The tenant refills at a fraction of the global
 *    rate, so a single project can never take the whole ceiling and two busy
 *    ones split it.
 *
 *  Both are taken from in one Lua call, atomically: either both buckets have
 *  the tokens and both are debited, or neither is touched and the caller is
 *  told how long until both do.
 *
 * Three details that are decisions rather than details:
 *
 *  - **One round trip per classification.** A classification is about 250 ms
 *    and a Redis call is about a millisecond, so drawing per request costs
 *    nothing measurable, and it is what lets each request take exactly what
 *    it sends rather than a chunk sized for an average.
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

/**
 * The braces are a Redis Cluster hash tag: the script takes from both buckets
 * in one EVAL, which the cluster only allows when every key hashes to one
 * slot. Without the tag it answers CROSSSLOT and the limiter falls back to the
 * local rate on every call, pacing each pod on its own.
 */
const BUCKET_KEY_PREFIX = "langwatch:{instant-evals:classifier-tokens}";

/** One bucket for the whole deployment. */
const GLOBAL_BUCKET_KEY = BUCKET_KEY_PREFIX;

/** One bucket per tenant, keyed by the project. */
function tenantBucketKey(tenantId: string): string {
  return `${BUCKET_KEY_PREFIX}:tenant:${tenantId}`;
}

/** Long enough that an idle bucket survives a quiet hour, short enough to expire. */
const BUCKET_TTL_MS = 3_600_000;

/**
 * Input tokens a second a pod allows itself when Redis cannot be reached.
 *
 * A fifth of the default global rate: slower than the real limit, and safe to
 * multiply by the handful of pods a deployment runs.
 */
export const LOCAL_FALLBACK_TOKENS_PER_SECOND = 60_000;

/** Never sleep longer than this in one go, so a cancelled query notices. */
const MAX_SLEEP_MS = 250;

/** What one classification asks the limiter for. */
export interface InstantEvalPermit {
  /** Estimated input tokens the request will send, text and questions. */
  readonly tokens: number;
  /** The project the request judges for, whose share of the rate it draws on. */
  readonly tenantId: string;
}

/**
 * Take the tokens a request needs, or wait until they are there.
 *
 * Deliberately one method: everything above this cares about being allowed to
 * send, not about how many tokens are left.
 */
export interface InstantEvalRateLimiter {
  acquire(permit: InstantEvalPermit, signal?: AbortSignal): Promise<void>;
}

/**
 * Refills both buckets and takes from both, or from neither.
 *
 * KEYS[1] is the global bucket, KEYS[2] the tenant's. Each bucket is a hash of
 * `tokens` and `at` (the last refill, epoch milliseconds). Returns the tokens
 * granted and, when none were, how long to wait before both buckets hold
 * enough. Two keys, so under Redis Cluster the caller has to hash-tag them or
 * run a single node; this deployment runs a single node.
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

export interface InstantEvalRateLimiterOptions {
  /** The process's Redis connection, or `null` to run on the local fallback. */
  readonly redis: RedisConnection | null;
  /** Input tokens a second the whole deployment may send. */
  readonly tokensPerSecond: number;
  /** Burst the global bucket may hold. Above the rate, so a skewed clock cannot stall it. */
  readonly capacity: number;
  /** Input tokens a second one tenant may send. */
  readonly tenantTokensPerSecond: number;
  /** Burst one tenant's bucket may hold. */
  readonly tenantCapacity: number;
  /** Injected so a suite can drive the bucket without sleeping. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class RedisInstantEvalRateLimiter implements InstantEvalRateLimiter {
  private localTokens: number;
  private localAt: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: InstantEvalRateLimiterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.localTokens = LOCAL_FALLBACK_TOKENS_PER_SECOND;
    this.localAt = this.now();
  }

  async acquire(
    permit: InstantEvalPermit,
    signal?: AbortSignal,
  ): Promise<void> {
    // Never more than the bucket can hold, or the request could wait forever
    // for a fill that never comes. A request past the capacity is one the
    // classifier will refuse anyway, so it is let through to be refused.
    const wanted = Math.max(
      1,
      Math.min(
        Math.ceil(permit.tokens),
        this.options.capacity,
        this.options.tenantCapacity,
      ),
    );
    for (;;) {
      signal?.throwIfAborted();
      const waitMs = await this.draw({ wanted, tenantId: permit.tenantId });
      if (waitMs === 0) return;
      await this.sleep(Math.min(waitMs, MAX_SLEEP_MS));
    }
  }

  /** Takes the tokens, or answers with how long the buckets need. */
  private async draw({
    wanted,
    tenantId,
  }: {
    wanted: number;
    tenantId: string;
  }): Promise<number> {
    const { redis } = this.options;
    if (!redis) return this.drawLocally(wanted);
    try {
      return await this.takeFromBuckets({ redis, wanted, tenantId });
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
    redis: RedisConnection;
    wanted: number;
    tenantId: string;
  }): Promise<number> {
    const reply = (await redis.eval(
      TAKE_TOKENS_SCRIPT,
      2,
      GLOBAL_BUCKET_KEY,
      tenantBucketKey(tenantId),
      String(this.now()),
      String(wanted),
      String(BUCKET_TTL_MS),
      String(this.options.capacity),
      String(this.options.tokensPerSecond),
      String(this.options.tenantCapacity),
      String(this.options.tenantTokensPerSecond),
    )) as [number | string, number | string];
    const granted = Number(reply[0]);
    const waitMs = Number(reply[1]);
    // A reply that is not two numbers would otherwise become `NaN`, and a
    // `NaN` wait is a loop that never sleeps and never gives up. Treated as
    // "come back in a moment", which is the safe reading of an answer we
    // cannot parse.
    if (Number.isFinite(granted) && granted >= wanted) return 0;
    return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : MAX_SLEEP_MS;
  }

  /**
   * The pod's own bucket, at a rate low enough to be safe times any pod count.
   *
   * Refilled the same way as the shared one so the two behave alike, which is
   * what keeps a Redis outage a slowdown rather than a different feature.
   */
  private drawLocally(wanted: number): number {
    const now = this.now();
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
    return Math.ceil(
      ((needed - this.localTokens) / LOCAL_FALLBACK_TOKENS_PER_SECOND) * 1000,
    );
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
