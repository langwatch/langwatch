import type { RedisConnection } from "@langwatch/redis-client";

import type { NlpLambdaArnCache } from "../../app/workflow.app.ts";

export type NlpLambdaArnRedis = Pick<RedisConnection, "get" | "set" | "del">;

/** Every pod's resolved per-project function, shared through the process's Redis. */
export class RedisNlpLambdaArnRepository implements NlpLambdaArnCache {
  static create(input: { redis: NlpLambdaArnRedis }): RedisNlpLambdaArnRepository {
    return new RedisNlpLambdaArnRepository(input.redis);
  }

  private constructor(private readonly redis: NlpLambdaArnRedis) {}

  find(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    await this.redis.set(input.key, input.value, "EX", input.ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
