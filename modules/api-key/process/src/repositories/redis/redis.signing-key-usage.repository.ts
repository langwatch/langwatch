import type { Cluster, Redis } from "ioredis";

import {
  SIGNING_KEY_USAGE_TTL_MS,
  type SigningKeyHourlyUsage,
  type SigningKeyUsageRepository,
} from "../signing-key-usage.repository.ts";

const KEY_PREFIX = "api-key:signing-key-usage:";

/** Only what the counters call; one hash per key per hour, each command on one slot. */
export type SigningKeyUsageRedis = Pick<Redis | Cluster, "hincrby" | "pexpire" | "hmget">;

function hashKey({ keyId, hour }: { keyId: string; hour: number }): string {
  return `${KEY_PREFIX}${keyId}:${hour}`;
}

/** The counts every pod adds to, over the deployment's own connection. */
export class RedisSigningKeyUsageRepository implements SigningKeyUsageRepository {
  private constructor(private readonly redis: SigningKeyUsageRedis) {}

  static create({ redis }: { redis: SigningKeyUsageRedis }): RedisSigningKeyUsageRepository {
    return new RedisSigningKeyUsageRepository(redis);
  }

  async add({ usage }: { usage: readonly SigningKeyHourlyUsage[] }): Promise<void> {
    await Promise.all(
      usage.map(async (entry) => {
        const key = hashKey(entry);
        if (entry.passed > 0) await this.redis.hincrby(key, "passed", entry.passed);
        if (entry.failed > 0) await this.redis.hincrby(key, "failed", entry.failed);
        await this.redis.pexpire(key, SIGNING_KEY_USAGE_TTL_MS);
      }),
    );
  }

  async findTotals({
    keyIds,
    fromHour,
    toHour,
  }: {
    keyIds: readonly string[];
    fromHour: number;
    toHour: number;
  }): Promise<{ keyId: string; passed: number; failed: number }[]> {
    const hours = Array.from(
      { length: Math.max(0, toHour - fromHour + 1) },
      (_, i) => fromHour + i,
    );
    return Promise.all(
      keyIds.map(async (keyId) => {
        const counts = await Promise.all(
          hours.map((hour) => this.redis.hmget(hashKey({ keyId, hour }), "passed", "failed")),
        );
        return counts.reduce(
          (total, [passed, failed]) => ({
            keyId,
            passed: total.passed + Number(passed ?? 0),
            failed: total.failed + Number(failed ?? 0),
          }),
          { keyId, passed: 0, failed: 0 },
        );
      }),
    );
  }
}
