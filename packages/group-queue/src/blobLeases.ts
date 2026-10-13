import type { Cluster, Redis as IORedis } from "ioredis";

import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_LEASE_SET_TTL_SECONDS,
  BLOB_LEASE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
} from "./blobConstants.ts";
import { GQ_BLOB_GRACE_LUA } from "./blobGraceLua.ts";
import { blobHolderSetKey, blobLeaseSetKey, redisBlobKey } from "./blobKeys.ts";
import { CachedLuaScript } from "./cachedLuaScript.ts";
import type { TenantId } from "./storage.ts";
import type { BlobRef } from "./tieredBlobStore.ts";

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

// KEYS[3] (the Redis-tier blob) is passed only for the redis tier, so the S3
// tier never co-slots a key that does not exist. Returns 1 when the release
// left nothing holding the blob and put it on the grace window, else 0.
const RELEASE_LUA = `${GQ_BLOB_GRACE_LUA}${REDIS_NOW_MS_LUA}
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
-- Remove the mirrored legacy token but deliberately retain the migration guard.
redis.call("SREM", KEYS[2], ARGV[1])
local graced = gqGraceExpireIfUnleased(KEYS[1], KEYS[2], #KEYS == 3 and KEYS[3] or "")
if redis.call("ZCARD", KEYS[1]) == 0 then redis.call("DEL", KEYS[1]) end
return graced
`;

// KEYS[5] (the OLD Redis-tier blob) is passed only when the retired ref is on
// the redis tier. Returns 1 when the retired lease was the last one and the old
// blob went onto the grace window, else 0. A same-blob transfer (a retry whose
// re-encode kept the hash) leaves KEYS[1] == KEYS[2], so the replacement lease
// is already in that set when the helper runs and the grace window is withheld.
const TRANSFER_LUA = `${GQ_BLOB_GRACE_LUA}${REDIS_NOW_MS_LUA}
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
return gqGraceExpireIfUnleased(KEYS[2], KEYS[4], #KEYS == 5 and KEYS[5] or "")
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
 * Per-holder, renewable leases for content-addressed blobs: each sorted-set
 * member is a holder identity, its score an absolute deadline. Releases
 * remove only that member; reclamation is exclusively lazy (TTL or sweep).
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

  private leaseKey({ projectId, hash }: { projectId: TenantId; hash: string }): string {
    return blobLeaseSetKey({ queueName: this.queueName, projectId, hash });
  }

  private legacyHolderKey({ projectId, hash }: { projectId: TenantId; hash: string }): string {
    return blobHolderSetKey({ queueName: this.queueName, projectId, hash });
  }

  /**
   * Record holder's lease and re-arm backstop; acquire and renew are the same
   * write to enable safe grace-window shortening.
   */
  async take(params: {
    projectId: TenantId;
    hash: string;
    holderId: string;
    tier: BlobRef["tier"];
  }): Promise<void> {
    await this.writeLease(params);
  }

  async renew(params: {
    projectId: TenantId;
    hash: string;
    holderId: string;
    tier: BlobRef["tier"];
  }): Promise<void> {
    await this.writeLease(params);
  }

  private async writeLease({
    projectId,
    hash,
    holderId,
    tier,
  }: {
    projectId: TenantId;
    hash: string;
    holderId: string;
    tier: BlobRef["tier"];
  }): Promise<void> {
    await takeScript.run(
      this.redis,
      ...this.blobKeyArgs({ projectId, hash, tier }),
      holderId,
      String(this.leaseTtlSeconds),
    );
  }

  /**
   * Retire holder's lease; apply grace window if it was the last holder (resolves
   * true when applied). Tier determines whether Redis bytes expire.
   */
  async release({
    projectId,
    hash,
    holderId,
    tier,
  }: {
    projectId: TenantId;
    hash: string;
    holderId: string;
    tier: BlobRef["tier"];
  }): Promise<boolean> {
    const graced = await releaseScript.run(
      this.redis,
      ...this.blobKeyArgs({ projectId, hash, tier }),
      holderId,
    );
    return Number(graced) === 1;
  }

  /**
   * The lease set, the guard set, and — redis tier only — the blob itself,
   * prefixed by the key count the Lua `#KEYS` branches read. s3 passes two
   * keys so cluster mode never has to co-slot a blob key that doesn't exist.
   */
  private blobKeyArgs({
    projectId,
    hash,
    tier,
  }: {
    projectId: TenantId;
    hash: string;
    tier: BlobRef["tier"];
  }): [number, ...string[]] {
    const keys = [this.leaseKey({ projectId, hash }), this.legacyHolderKey({ projectId, hash })];
    if (tier === "redis") {
      keys.push(redisBlobKey({ queueName: this.queueName, projectId, hash }));
    }
    return [keys.length, ...keys];
  }

  /**
   * Atomically move lease to replacement blob; apply old blob's grace window if it
   * was the last holder (resolves true when applied).
   */
  async transfer({
    newProjectId,
    newHash,
    newHolderId,
    oldProjectId,
    oldHash,
    oldHolderId,
    oldTier,
  }: {
    newProjectId: TenantId;
    newHash: string;
    newHolderId: string;
    oldProjectId: TenantId;
    oldHash: string;
    oldHolderId: string;
    oldTier: BlobRef["tier"];
  }): Promise<boolean> {
    const keys = [
      this.leaseKey({ projectId: newProjectId, hash: newHash }),
      this.leaseKey({ projectId: oldProjectId, hash: oldHash }),
      this.legacyHolderKey({ projectId: newProjectId, hash: newHash }),
      this.legacyHolderKey({ projectId: oldProjectId, hash: oldHash }),
    ];
    if (oldTier === "redis") {
      keys.push(
        redisBlobKey({
          queueName: this.queueName,
          projectId: oldProjectId,
          hash: oldHash,
        }),
      );
    }
    const graced = await transferScript.run(
      this.redis,
      keys.length,
      ...keys,
      newHolderId,
      oldHolderId,
      String(this.leaseTtlSeconds),
    );
    return Number(graced) === 1;
  }

  async countLive({ projectId, hash }: { projectId: TenantId; hash: string }): Promise<number> {
    // Test-only inspection seam. This is deliberately not a passive read: the
    // Lua script prunes expired members and deletes an empty lease set.
    return Number(await countLiveScript.run(this.redis, 1, this.leaseKey({ projectId, hash })));
  }
}
