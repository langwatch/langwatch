import type { Cluster, Redis as IORedis } from "ioredis";

import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_LEASE_SET_TTL_SECONDS,
  BLOB_LEASE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
} from "./blobConstants";
import { blobHolderSetKey, blobLeaseSetKey, redisBlobKey } from "./blobKeys";
import { CachedLuaScript } from "./cachedLuaScript";

const REDIS_NOW_MS_LUA = `
local now = redis.call("TIME")
local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
`;

const TAKE_LUA = `${REDIS_NOW_MS_LUA}
local ttlSeconds = tonumber(ARGV[2])
local deadlineMs = nowMs + (ttlSeconds * 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
redis.call("ZADD", KEYS[1], deadlineMs, ARGV[1])
redis.call("EXPIRE", KEYS[1], ${BLOB_LEASE_SET_TTL_SECONDS})
redis.call("SADD", KEYS[2], "${LEGACY_HOLDER_LEASE_GUARD}", ARGV[1])
redis.call("EXPIRE", KEYS[2], ${BLOB_LEASE_SET_TTL_SECONDS})
if #KEYS == 3 then redis.call("EXPIRE", KEYS[3], ${BLOB_BACKSTOP_TTL_SECONDS}) end
return deadlineMs
`;

const RELEASE_LUA = `${REDIS_NOW_MS_LUA}
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
-- Remove the mirrored legacy token but deliberately retain the migration guard.
redis.call("SREM", KEYS[2], ARGV[1])
return removed
`;

const TRANSFER_LUA = `${REDIS_NOW_MS_LUA}
local ttlSeconds = tonumber(ARGV[3])
local deadlineMs = nowMs + (ttlSeconds * 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
if KEYS[1] ~= KEYS[2] then redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", nowMs) end
redis.call("ZADD", KEYS[1], deadlineMs, ARGV[1])
redis.call("EXPIRE", KEYS[1], ${BLOB_LEASE_SET_TTL_SECONDS})
if KEYS[1] ~= KEYS[2] or ARGV[1] ~= ARGV[2] then
  redis.call("ZREM", KEYS[2], ARGV[2])
end
if redis.call("ZCARD", KEYS[2]) == 0 then redis.call("DEL", KEYS[2]) end
redis.call("SADD", KEYS[3], "${LEGACY_HOLDER_LEASE_GUARD}", ARGV[1])
redis.call("EXPIRE", KEYS[3], ${BLOB_LEASE_SET_TTL_SECONDS})
if KEYS[3] ~= KEYS[4] or ARGV[1] ~= ARGV[2] then
  redis.call("SREM", KEYS[4], ARGV[2])
end
return deadlineMs
`;

const COUNT_LIVE_LUA = `${REDIS_NOW_MS_LUA}
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
local count = redis.call("ZCARD", KEYS[1])
if count == 0 then redis.call("DEL", KEYS[1]) end
return count
`;

const takeScript = new CachedLuaScript(TAKE_LUA);
const releaseScript = new CachedLuaScript(RELEASE_LUA);
const transferScript = new CachedLuaScript(TRANSFER_LUA);
const countLiveScript = new CachedLuaScript(COUNT_LIVE_LUA);

/**
 * Per-holder, renewable leases for content-addressed blobs. Each sorted-set
 * member is a holder identity and its score is an absolute Redis-time deadline.
 * Releases remove only that member; blob reclamation is exclusively lazy via
 * Redis TTL or the durable-store lifecycle sweep.
 */
export class BlobLeases {
  private readonly redis: IORedis | Cluster;
  private readonly queueName: string;
  private readonly leaseTtlSeconds: number;

  constructor({
    redis,
    queueName,
    leaseTtlSeconds = BLOB_LEASE_TTL_SECONDS,
  }: {
    redis: IORedis | Cluster;
    queueName: string;
    leaseTtlSeconds?: number;
  }) {
    this.redis = redis;
    this.queueName = queueName;
    this.leaseTtlSeconds = leaseTtlSeconds;
  }

  private leaseKey({
    projectId,
    hash,
  }: {
    projectId: TenantId;
    hash: string;
  }): string {
    return blobLeaseSetKey({ queueName: this.queueName, projectId, hash });
  }

  private legacyHolderKey({
    projectId,
    hash,
  }: {
    projectId: TenantId;
    hash: string;
  }): string {
    return blobHolderSetKey({ queueName: this.queueName, projectId, hash });
  }

  async take({
    projectId,
    hash,
    holderId,
  }: {
    projectId: TenantId;
    hash: string;
    holderId: string;
  }): Promise<void> {
    await takeScript.run(
      this.redis,
      2,
      this.leaseKey({ projectId, hash }),
      this.legacyHolderKey({ projectId, hash }),
      holderId,
      String(this.leaseTtlSeconds),
    );
  }

  async renew({
    projectId,
    hash,
    holderId,
    tier,
  }: {
    projectId: TenantId;
    hash: string;
    holderId: string;
    tier: "redis" | "s3";
  }): Promise<void> {
    const keys = [
      this.leaseKey({ projectId, hash }),
      this.legacyHolderKey({ projectId, hash }),
    ];
    if (tier === "redis") {
      keys.push(redisBlobKey({ queueName: this.queueName, projectId, hash }));
    }
    await takeScript.run(
      this.redis,
      keys.length,
      ...keys,
      holderId,
      String(this.leaseTtlSeconds),
    );
  }

  async release({
    projectId,
    hash,
    holderId,
  }: {
    projectId: TenantId;
    hash: string;
    holderId: string;
  }): Promise<void> {
    await releaseScript.run(
      this.redis,
      2,
      this.leaseKey({ projectId, hash }),
      this.legacyHolderKey({ projectId, hash }),
      holderId,
    );
  }

  async transfer({
    newProjectId,
    newHash,
    newHolderId,
    oldProjectId,
    oldHash,
    oldHolderId,
  }: {
    newProjectId: TenantId;
    newHash: string;
    newHolderId: string;
    oldProjectId: TenantId;
    oldHash: string;
    oldHolderId: string;
  }): Promise<void> {
    await transferScript.run(
      this.redis,
      4,
      this.leaseKey({ projectId: newProjectId, hash: newHash }),
      this.leaseKey({ projectId: oldProjectId, hash: oldHash }),
      this.legacyHolderKey({ projectId: newProjectId, hash: newHash }),
      this.legacyHolderKey({ projectId: oldProjectId, hash: oldHash }),
      newHolderId,
      oldHolderId,
      String(this.leaseTtlSeconds),
    );
  }

  /**
   * Directly extends the Redis TTL on the lease-set keys and the blob's own
   * redis-tier key to at least `ttlSeconds` — independent of the fixed
   * `BLOB_LEASE_SET_TTL_SECONDS` / `BLOB_BACKSTOP_TTL_SECONDS` constants
   * `take`/`renew` bake into `TAKE_LUA`. Plain `EXPIRE` calls, not a Lua script:
   * passing a larger `ttlSeconds` to `take`/`renew` only extends the *logical*
   * lease deadline recorded as the sorted-set member's score — the *physical*
   * Redis TTL on the lease-set key and the blob key stays capped at the
   * hardcoded constant, so the blob would still be reclaimed on schedule. This
   * method touches only the real TTLs, and never the Lua scripts, so it cannot
   * perturb `take`/`renew`/`release`/`transfer`'s atomicity.
   *
   * Used by the DLQ dead-letter path (#719/#720): a body-present drop is
   * quarantined for a window that can exceed the routine lease/backstop TTL,
   * so without this the referenced blob could be reclaimed before an operator
   * drains the dead-letter. s3-tier objects have no per-object Redis TTL (left
   * to the bucket lifecycle, ADR-029), so only the lease bookkeeping is
   * extended for that tier — the caller's tier param mirrors `renew`'s.
   */
  async extendTtl({
    projectId,
    hash,
    tier,
    ttlSeconds,
  }: {
    projectId: TenantId;
    hash: string;
    tier: "redis" | "s3";
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.expire(this.leaseKey({ projectId, hash }), ttlSeconds);
    await this.redis.expire(
      this.legacyHolderKey({ projectId, hash }),
      ttlSeconds,
    );
    if (tier === "redis") {
      await this.redis.expire(
        redisBlobKey({ queueName: this.queueName, projectId, hash }),
        ttlSeconds,
      );
    }
  }

  async countLive({
    projectId,
    hash,
  }: {
    projectId: TenantId;
    hash: string;
  }): Promise<number> {
    // Test-only inspection seam. This is deliberately not a passive read: the
    // Lua script prunes expired members and deletes an empty lease set.
    return Number(
      await countLiveScript.run(
        this.redis,
        1,
        this.leaseKey({ projectId, hash }),
      ),
    );
  }
}
