import {
  LANGY_GITHUB_PR_BUCKET_TTL_SECONDS,
  LangyGithubPrCountRepository,
} from "../langy-github-pr-count.repository.ts";

/** The Redis surface the count needs. */
export type LangyGithubPrCountRedis = {
  scard: (key: string) => Promise<number>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
};

export class LangyGithubPrCountRedisRepository extends LangyGithubPrCountRepository {
  static create({ redis }: { redis: LangyGithubPrCountRedis }): LangyGithubPrCountRedisRepository {
    return new LangyGithubPrCountRedisRepository(redis);
  }

  private constructor(private readonly redis: LangyGithubPrCountRedis) {
    super();
  }

  count(key: string): Promise<number> {
    return this.redis.scard(key);
  }

  /** Every add sets the lifetime; the key rotates daily, so no bucket outlives two days. */
  async add({
    key,
    pullRequests,
  }: {
    key: string;
    pullRequests: readonly string[];
  }): Promise<void> {
    if (pullRequests.length === 0) return;
    await this.redis.sadd(key, ...pullRequests);
    await this.redis.expire(key, LANGY_GITHUB_PR_BUCKET_TTL_SECONDS);
  }
}
