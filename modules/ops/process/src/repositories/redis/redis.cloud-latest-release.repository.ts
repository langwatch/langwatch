import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  type CloudLatestRelease,
  CloudLatestReleaseRepository,
  cloudLatestReleaseSchema,
} from "../cloud-latest-release.repository.ts";

/** One JSON string key, replaced by each report's reply and deleted when it names none. */
export class RedisCloudLatestReleaseRepository extends CloudLatestReleaseRepository {
  private static readonly key = "ops:usage_report:latest_release";

  static create({ redis }: { redis: IORedis | Cluster }): RedisCloudLatestReleaseRepository {
    return new RedisCloudLatestReleaseRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save(latest: CloudLatestRelease | null): Promise<void> {
    if (latest === null) {
      await this.redis.del(RedisCloudLatestReleaseRepository.key);
      return;
    }
    await this.redis.set(RedisCloudLatestReleaseRepository.key, JSON.stringify(latest));
  }

  async find(): Promise<CloudLatestRelease[]> {
    const raw = await this.redis.get(RedisCloudLatestReleaseRepository.key);
    if (raw === null) return [];
    try {
      const parsed = cloudLatestReleaseSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  }
}
