import { randomUUID } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { MigrationLeaseRepository } from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";

const logger = createLogger("langwatch:system-migrations:lease");

const KEY_PREFIX = "system-migrations:lease:";

/** Renew/release only what THIS process acquired: compare the stored token
 *  before touching the key, atomically, or a slow pass could extend (or
 *  delete) a lease another process has legitimately taken over. */
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

/**
 * The runner's named leases on Redis - one claim per organization.
 * Fail-safe direction: no Redis, or any Redis error, reads as "not
 * acquired" - no organization is worked on this boot, and the legacy paths
 * keep answering.
 */
export class RedisMigrationLeaseRepository implements MigrationLeaseRepository {
  private readonly token = randomUUID();

  constructor(private readonly redis: Redis | Cluster | null) {}

  async acquire({
    name,
    ttlMs,
  }: {
    name: string;
    ttlMs: number;
  }): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const result = await this.redis.set(
        `${KEY_PREFIX}${name}`,
        this.token,
        "PX",
        ttlMs,
        "NX",
      );
      return result === "OK";
    } catch (error) {
      // Standing down is right, but silence is not: the runner logs every
      // falsy acquire as "another process holds the lease", so an unreachable
      // Redis would read as ordinary contention and the migration would never
      // run, on any boot, without a word anywhere.
      logger.warn(
        { error, name },
        "could not acquire the migration lease; treating it as held elsewhere",
      );
      return false;
    }
  }

  async renew({
    name,
    ttlMs,
  }: {
    name: string;
    ttlMs: number;
  }): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const result = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        `${KEY_PREFIX}${name}`,
        this.token,
        String(ttlMs),
      );
      return result === 1;
    } catch (error) {
      // A lost renewal stops the pass mid-flight, so the reason it was lost
      // is worth having.
      logger.warn(
        { error, name },
        "could not renew the migration lease; treating it as lost",
      );
      return false;
    }
  }

  async release({ name }: { name: string }): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.eval(
        RELEASE_SCRIPT,
        1,
        `${KEY_PREFIX}${name}`,
        this.token,
      );
    } catch {
      // Best-effort: an unreleased lease expires on its own TTL.
    }
  }
}
