import type { StoreClients } from "@langwatch/process-stores/members";

import { LwqlUnconfirmedSinceRepository } from "../langwatch-ql-unconfirmed-since.repository.ts";

const KEY = "lwql:collection-unconfirmed-since";
/** Checks run every 5 minutes; a run no check has extended for an hour has ended. */
const RUN_TTL_MS = 60 * 60_000;

/**
 * Keep a stored first failure time and extend its hour, or store this
 * failure's time when there is none or the stored value is not a time, in one
 * step. Two checks can be delivered at once; as separate commands, both could
 * read a value that is not a time and each write their own, and the later
 * write would move the first failure forward. Returns the time now stored.
 */
const MARK_SCRIPT = `
local stored = redis.call("get", KEYS[1])
local since = tonumber(stored)
if since and since == since and since > 0 and since ~= math.huge then
  redis.call("pexpire", KEYS[1], ARGV[2])
  return stored
end
redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])
return ARGV[1]
`;

/** Only what the clock calls. */
export type LwqlUnconfirmedSinceRedis = Pick<StoreClients["redis"], "eval" | "del">;

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
    const since = Number(
      await this.redis.eval(MARK_SCRIPT, 1, KEY, String(at), String(RUN_TTL_MS)),
    );
    return Number.isFinite(since) && since > 0 ? since : at;
  }

  async clear(): Promise<void> {
    await this.redis.del(KEY);
  }
}
