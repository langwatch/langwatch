// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RedisConnection } from "@langwatch/redis-client";

import type { NurturingClaimRepository } from "../nurturing-claim.repository.ts";

/** Only the command this repository calls. */
export type NurturingClaimRedis = Pick<RedisConnection, "set">;

/** The keys the process-wide idempotency claim wrote, so a rolling deploy still dedupes. */
const CLAIM_KEY_PREFIX = "member:idempotency:";

/** One SET NX EX per key: the first caller in the window wins. */
export class RedisNurturingClaimRepository implements NurturingClaimRepository {
  readonly #redis: NurturingClaimRedis;

  static create({
    redis,
  }: Readonly<{ redis: NurturingClaimRedis }>): RedisNurturingClaimRepository {
    return new RedisNurturingClaimRepository(redis);
  }

  private constructor(redis: NurturingClaimRedis) {
    this.#redis = redis;
  }

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    return (
      (await this.#redis.set(`${CLAIM_KEY_PREFIX}${key}`, "claimed", "EX", ttlSeconds, "NX")) ===
      "OK"
    );
  }
}
