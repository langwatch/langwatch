/**
 * The two buckets held in this process: the Redis script's refill and take,
 * over a map, for a process that opens no Redis.
 */

import type {
  InstantEvalRateLimitBuckets,
  InstantEvalRateLimitRepository,
} from "../instant-eval-rate-limit.repository.ts";

type Bucket = { tokens: number; at: number };

const GLOBAL_BUCKET = "global";

export class MemoryInstantEvalRateLimitRepository implements InstantEvalRateLimitRepository {
  #buckets = new Map<string, Bucket>();

  private constructor() {}

  static create(): MemoryInstantEvalRateLimitRepository {
    return new MemoryInstantEvalRateLimitRepository();
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
    const global = this.#refilled({
      key: GLOBAL_BUCKET,
      nowMs,
      capacity: buckets.capacity,
      refill: buckets.tokensPerSecond,
    });
    const tenant = this.#refilled({
      key: `tenant:${tenantId}`,
      nowMs,
      capacity: buckets.tenantCapacity,
      refill: buckets.tenantTokensPerSecond,
    });
    const wait = Math.max(
      waitFor({ tokens: global.tokens, wanted, refill: buckets.tokensPerSecond }),
      waitFor({ tokens: tenant.tokens, wanted, refill: buckets.tenantTokensPerSecond }),
    );
    if (wait === 0) {
      global.tokens -= wanted;
      tenant.tokens -= wanted;
    }
    return wait;
  }

  #refilled({
    key,
    nowMs,
    capacity,
    refill,
  }: {
    key: string;
    nowMs: number;
    capacity: number;
    refill: number;
  }): Bucket {
    const bucket = this.#buckets.get(key) ?? { tokens: capacity, at: nowMs };
    const elapsedSeconds = Math.max(0, nowMs - bucket.at) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refill);
    bucket.at = nowMs;
    this.#buckets.set(key, bucket);
    return bucket;
  }
}

function waitFor({
  tokens,
  wanted,
  refill,
}: {
  tokens: number;
  wanted: number;
  refill: number;
}): number {
  if (tokens >= wanted) return 0;
  return Math.ceil(((wanted - tokens) / refill) * 1000);
}
