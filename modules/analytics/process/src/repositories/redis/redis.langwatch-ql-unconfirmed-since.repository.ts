import type { StoreClients } from "@langwatch/process-stores/members";

import { LwqlUnconfirmedSinceRepository } from "../langwatch-ql-unconfirmed-since.repository.ts";

const KEY = "lwql:collection-unconfirmed-since";
/** Checks run every 5 minutes; a run no check has extended for an hour has ended. */
const RUN_TTL_MS = 60 * 60_000;

/** Only what the clock calls. */
export type LwqlUnconfirmedSinceRedis = Pick<
  StoreClients["redis"],
  "set" | "get" | "pexpire" | "del"
>;

/** The first failure's time in the deployment's Redis. */
export class RedisLwqlUnconfirmedSinceRepository extends LwqlUnconfirmedSinceRepository {
  private constructor(private readonly redis: LwqlUnconfirmedSinceRedis) {
    super();
  }

  static create({
    redis,
  }: {
    redis: LwqlUnconfirmedSinceRedis;
  }): RedisLwqlUnconfirmedSinceRepository {
    return new RedisLwqlUnconfirmedSinceRepository(redis);
  }

  async mark(at: number): Promise<number> {
    await this.redis.set(KEY, String(at), "PX", RUN_TTL_MS, "NX");
    const since = Number(await this.redis.get(KEY));

    if (!Number.isFinite(since) || since <= 0) {
      await this.redis.set(KEY, String(at), "PX", RUN_TTL_MS);
      return at;
    }

    await this.redis.pexpire(KEY, RUN_TTL_MS);
    return since;
  }

  async clear(): Promise<void> {
    await this.redis.del(KEY);
  }
}
