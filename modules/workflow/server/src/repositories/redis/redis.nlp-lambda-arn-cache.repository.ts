/**
 * The resolved-ARN store shared across every pod, backed by the queue's own Redis.
 *
 * An ARN costs 2-N AWS control-plane calls against a REGIONAL quota, so sharing one
 * pod's resolution across the fleet is what keeps a burst of studio opens from
 * exhausting it. A deployment with no Redis falls back to
 * `InMemoryNlpLambdaArnCacheAdapter`, which is slower rather than wrong.
 */
import { NlpLambdaArnCachePort } from "../../ports/nlp-lambda-arn.port.ts";

const CACHE_PREFIX = "nlp_lambda_arn:v1:";

/** The minimal ioredis surface this adapter needs. */
export interface NlpLambdaArnRedisConnection {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export class RedisNlpLambdaArnCacheRepository extends NlpLambdaArnCachePort {
  static create(redis: NlpLambdaArnRedisConnection): RedisNlpLambdaArnCacheRepository {
    return new RedisNlpLambdaArnCacheRepository(redis);
  }

  private constructor(private readonly redis: NlpLambdaArnRedisConnection) {
    super();
  }

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
