/**
 * This process's two ways of sharing a project's resolved NLP Lambda ARN: a
 * per-process map when there is no shared cache, and Redis when there is.
 *
 * An ARN costs 2-N AWS control-plane calls against a REGIONAL quota, so
 * sharing one pod's resolution across the fleet is what keeps a burst of
 * studio opens from exhausting it. `MemoryNlpLambdaArnCache` is slower rather
 * than wrong for a deployment with no Redis to share.
 */
import type { NlpLambdaArnCache } from "@langwatch/workflow-server";

type Entry = Readonly<{ value: string; expiresAt: number }>;

export class MemoryNlpLambdaArnCache implements NlpLambdaArnCache {
  static create(options: { now?: () => number } = {}): MemoryNlpLambdaArnCache {
    return new MemoryNlpLambdaArnCache(options.now ?? Date.now);
  }

  private readonly entries = new Map<string, Entry>();

  private constructor(private readonly now: () => number) {}

  tryGet(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(null);

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);

      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    this.entries.set(input.key, {
      value: input.value,
      expiresAt: this.now() + input.ttlSeconds * 1000,
    });

    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);

    return Promise.resolve();
  }
}

const CACHE_PREFIX = "nlp_lambda_arn:v1:";

/** The minimal ioredis surface this cache needs. */
export interface NlpLambdaArnRedisConnection {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisNlpLambdaArnCache implements NlpLambdaArnCache {
  static create(redis: NlpLambdaArnRedisConnection): RedisNlpLambdaArnCache {
    return new RedisNlpLambdaArnCache(redis);
  }

  private constructor(private readonly redis: NlpLambdaArnRedisConnection) {}

  async tryGet(key: string): Promise<string | null> {
    return this.redis.get(`${CACHE_PREFIX}${key}`);
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    await this.redis.setex(`${CACHE_PREFIX}${input.key}`, input.ttlSeconds, input.value);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(`${CACHE_PREFIX}${key}`);
  }
}
