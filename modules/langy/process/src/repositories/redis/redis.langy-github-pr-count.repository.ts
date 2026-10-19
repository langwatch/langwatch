import {
  LANGY_GITHUB_PR_BUCKET_TTL_SECONDS,
  LangyGithubPrCountRepository,
} from "../langy-github-pr-count.repository.ts";

/** The Redis surface the counter needs. */
export type LangyGithubPrCountRedis = {
  get: (key: string) => Promise<string | null>;
  incrby: (key: string, amount: number) => Promise<number>;
  decr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  eval: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
};

/** Check-and-decrement in one step, so a double release can never take the count below zero. */
const FLOORED_DECREMENT =
  "local n = tonumber(redis.call('GET', KEYS[1]) or '0')\n" +
  "if n <= 0 then return 0 end\n" +
  "return redis.call('DECR', KEYS[1])";

export class LangyGithubPrCountRedisRepository extends LangyGithubPrCountRepository {
  static create({ redis }: { redis: LangyGithubPrCountRedis }): LangyGithubPrCountRedisRepository {
    return new LangyGithubPrCountRedisRepository(redis);
  }

  private constructor(private readonly redis: LangyGithubPrCountRedis) {
    super();
  }

  async count(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    return raw ? Number.parseInt(raw, 10) : 0;
  }

  /**
   * A bucket's lifetime is set when its first increment lands, retried once. A key that still
   * has none outlives its day, which is operator-visible, and the count stays correct.
   */
  async add({ key, amount }: { key: string; amount: number }): Promise<number> {
    const count = await this.redis.incrby(key, amount);
    if (count === amount) await this.giveLifetime(key);
    return count;
  }

  async takeBack(key: string): Promise<void> {
    await this.redis.decr(key);
  }

  async release(key: string): Promise<void> {
    await this.redis.eval(FLOORED_DECREMENT, 1, key);
  }

  private async giveLifetime(key: string): Promise<void> {
    try {
      await this.redis.expire(key, LANGY_GITHUB_PR_BUCKET_TTL_SECONDS);
    } catch {
      await this.redis.expire(key, LANGY_GITHUB_PR_BUCKET_TTL_SECONDS).catch(() => undefined);
    }
  }
}
