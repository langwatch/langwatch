import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { TopicClusteringClaimRepository } from "../topic-clustering-claim.repository.ts";

/** The Redis tier: `SET NX EX` claims and plain keys, as main's gate and seeds wrote them. */
export class RedisTopicClusteringClaimRepository implements TopicClusteringClaimRepository {
  static create(redis: ProcessMembers["redis"]): RedisTopicClusteringClaimRepository {
    return new RedisTopicClusteringClaimRepository(redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {}

  async claim(input: { key: string; ttlSeconds: number }): Promise<boolean> {
    const result = await this.redis.set(input.key, "1", "EX", input.ttlSeconds, "NX");
    return result === "OK";
  }

  async release(input: { key: string }): Promise<void> {
    await this.redis.del(input.key);
  }

  async mark(input: { key: string; value: string }): Promise<void> {
    await this.redis.set(input.key, input.value);
  }

  async isMarked(input: { key: string }): Promise<boolean> {
    return (await this.redis.get(input.key)) !== null;
  }
}
