import { type SelfHostedNotice, selfHostedNoticeSchema } from "@langwatch/ops-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { CloudNoticeRepository } from "../cloud-notice.repository.ts";

/**
 * One JSON array key, replaced by each report's reply and deleted when it names none. It expires
 * after three days, so a withdrawn notice leaves an install whose reports no longer reach Cloud.
 */
export class RedisCloudNoticeRepository extends CloudNoticeRepository {
  private static readonly key = "ops:usage_report:notices";
  private static readonly ttlSeconds = 3 * 24 * 60 * 60;

  static create({ redis }: { redis: IORedis | Cluster }): RedisCloudNoticeRepository {
    return new RedisCloudNoticeRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save(notices: readonly SelfHostedNotice[]): Promise<void> {
    if (notices.length === 0) {
      await this.redis.del(RedisCloudNoticeRepository.key);
      return;
    }
    await this.redis.set(
      RedisCloudNoticeRepository.key,
      JSON.stringify(notices),
      "EX",
      RedisCloudNoticeRepository.ttlSeconds,
    );
  }

  async find(): Promise<SelfHostedNotice[]> {
    const raw = await this.redis.get(RedisCloudNoticeRepository.key);
    if (raw === null) return [];
    try {
      const held: unknown = JSON.parse(raw);
      if (!Array.isArray(held)) return [];
      return held.flatMap((each) => {
        const parsed = selfHostedNoticeSchema.safeParse(each);
        return parsed.success ? [parsed.data] : [];
      });
    } catch {
      return [];
    }
  }
}
