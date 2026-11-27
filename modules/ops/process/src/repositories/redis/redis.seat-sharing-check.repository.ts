import { seatSharingCheckSchema, type SeatSharingCheck } from "@langwatch/ops-contract";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { SeatSharingCheckRepository } from "../seat-sharing-check.repository.ts";

/** One JSON string key, replaced by each check. */
export class RedisSeatSharingCheckRepository extends SeatSharingCheckRepository {
  private static readonly key = "ops:seat_sharing:last_check";

  static create({ redis }: { redis: IORedis | Cluster }): RedisSeatSharingCheckRepository {
    return new RedisSeatSharingCheckRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save(check: SeatSharingCheck): Promise<void> {
    await this.redis.set(RedisSeatSharingCheckRepository.key, JSON.stringify(check));
  }

  async find(): Promise<SeatSharingCheck[]> {
    const raw = await this.redis.get(RedisSeatSharingCheckRepository.key);
    if (raw === null) return [];
    try {
      const parsed = seatSharingCheckSchema.safeParse(JSON.parse(raw));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  }
}
