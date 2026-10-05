/**
 * The buckets in Redis, because the quota is the key's, not a pod's: one
 * EVAL refills and takes from both. @see specs/instant-evals/classifier.feature
 */

import type {
  InstantEvalRateLimitBuckets,
  InstantEvalRateLimitRepository,
} from "../instant-eval-rate-limit.repository.ts";

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

/** The Redis surface this repository uses, structurally. */
export type InstantEvalRateLimiterRedis = {
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
};

/** How long to wait when the reply cannot be read: "come back in a moment". */
const UNREADABLE_REPLY_WAIT_MS = 250;

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

export class RedisInstantEvalRateLimitRepository implements InstantEvalRateLimitRepository {
  private constructor(private readonly redis: InstantEvalRateLimiterRedis) {}

  static create(redis: InstantEvalRateLimiterRedis): RedisInstantEvalRateLimitRepository {
    return new RedisInstantEvalRateLimitRepository(redis);
  }

  async take({
    wanted,
    tenantId,
    nowMs,
    buckets,
  }: {
    wanted: number;
    tenantId: string;
    nowMs: number;
    buckets: InstantEvalRateLimitBuckets;
  }): Promise<number> {
    const reply = await this.redis.eval(
      TAKE_TOKENS_SCRIPT,
      2,
      GLOBAL_BUCKET_KEY,
      tenantBucketKey(tenantId),
      String(nowMs),
      String(wanted),
      String(BUCKET_TTL_MS),
      String(buckets.capacity),
      String(buckets.tokensPerSecond),
      String(buckets.tenantCapacity),
      String(buckets.tenantTokensPerSecond),
    );
    const [granted, waitMs] = readReply(reply);
    // A NaN wait is a loop that never sleeps and never gives up.
    if (Number.isFinite(granted) && granted >= wanted) return 0;
    return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : UNREADABLE_REPLY_WAIT_MS;
  }
}

/** The script's two numbers, or two NaNs when the reply is not that shape. */
function readReply(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length < 2) return [Number.NaN, Number.NaN];
  return [Number(reply[0]), Number(reply[1])];
}
