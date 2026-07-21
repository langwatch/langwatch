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
