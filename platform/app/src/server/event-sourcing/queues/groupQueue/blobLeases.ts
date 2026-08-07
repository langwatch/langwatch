import type { Cluster, Redis as IORedis } from "ioredis";

import type { TenantId } from "~/server/event-sourcing/domain/tenantId";

import {
  BLOB_BACKSTOP_TTL_SECONDS,
  BLOB_LEASE_SET_TTL_SECONDS,
  BLOB_LEASE_TTL_SECONDS,
  LEGACY_HOLDER_LEASE_GUARD,
} from "./blobConstants";
import { GQ_BLOB_EXPIRE_AT_LEAST_LUA } from "./blobExpireLua";
import { GQ_BLOB_GRACE_LUA } from "./blobGraceLua";
import { blobHolderSetKey, blobLeaseSetKey, redisBlobKey } from "./blobKeys";
import { CachedLuaScript } from "./cachedLuaScript";
import type { BlobRef } from "./tieredBlobStore";

const REDIS_NOW_MS_LUA = `
local now = redis.call("TIME")
local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
`;

const TAKE_LUA = `${GQ_BLOB_EXPIRE_AT_LEAST_LUA}${REDIS_NOW_MS_LUA}
local ttlSeconds = tonumber(ARGV[2])
local deadlineMs = nowMs + (ttlSeconds * 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
redis.call("ZADD", KEYS[1], deadlineMs, ARGV[1])
gqExpireAtLeast(KEYS[1], ${BLOB_LEASE_SET_TTL_SECONDS})
redis.call("SADD", KEYS[2], "${LEGACY_HOLDER_LEASE_GUARD}", ARGV[1])
gqExpireAtLeast(KEYS[2], ${BLOB_LEASE_SET_TTL_SECONDS})
if #KEYS == 3 then gqExpireAtLeast(KEYS[3], ${BLOB_BACKSTOP_TTL_SECONDS}) end
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
const TRANSFER_LUA = `${GQ_BLOB_EXPIRE_AT_LEAST_LUA}${GQ_BLOB_GRACE_LUA}${REDIS_NOW_MS_LUA}
local ttlSeconds = tonumber(ARGV[3])
local deadlineMs = nowMs + (ttlSeconds * 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
if KEYS[1] ~= KEYS[2] then redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", nowMs) end
redis.call("ZADD", KEYS[1], deadlineMs, ARGV[1])
gqExpireAtLeast(KEYS[1], ${BLOB_LEASE_SET_TTL_SECONDS})
if KEYS[1] ~= KEYS[2] or ARGV[1] ~= ARGV[2] then
  redis.call("ZREM", KEYS[2], ARGV[2])
end
if redis.call("ZCARD", KEYS[2]) == 0 then redis.call("DEL", KEYS[2]) end
redis.call("SADD", KEYS[3], "${LEGACY_HOLDER_LEASE_GUARD}", ARGV[1])
gqExpireAtLeast(KEYS[3], ${BLOB_LEASE_SET_TTL_SECONDS})
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

/**
 * The dead-letter's holder token. One shared constant, not a per-entry id — see
 * {@link BlobLeases.holdForDlq}.
 */
const DLQ_LEASE_HOLDER_ID = "gq:dlq";

/**
 * {@link TAKE_LUA}'s shape, with the caller's window used for the physical
 * `EXPIRE`s as well as the deadline. That single difference is the point: TAKE
 * hardcodes the routine constants there, which is exactly what would let the
 * dead-letter outlive its own blob.
 */
const HOLD_FOR_DLQ_LUA = `${GQ_BLOB_EXPIRE_AT_LEAST_LUA}${REDIS_NOW_MS_LUA}
local ttlSeconds = tonumber(ARGV[2])
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
redis.call("ZADD", KEYS[1], nowMs + (ttlSeconds * 1000), ARGV[1])
gqExpireAtLeast(KEYS[1], ttlSeconds)
redis.call("SADD", KEYS[2], "${LEGACY_HOLDER_LEASE_GUARD}", ARGV[1])
gqExpireAtLeast(KEYS[2], ttlSeconds)
if #KEYS == 3 then gqExpireAtLeast(KEYS[3], ttlSeconds) end
return 1
`;

const takeScript = new CachedLuaScript(TAKE_LUA);
const releaseScript = new CachedLuaScript(RELEASE_LUA);
const transferScript = new CachedLuaScript(TRANSFER_LUA);
const countLiveScript = new CachedLuaScript(COUNT_LIVE_LUA);
const holdForDlqScript = new CachedLuaScript(HOLD_FOR_DLQ_LUA);

/**
 * Per-holder, renewable leases for content-addressed blobs. Each sorted-set
 * member is a holder identity and its score is an absolute Redis-time deadline.
 * Releases remove only that member; blob reclamation is exclusively lazy via
 * Redis TTL or the durable-store lifecycle sweep. Retiring the last lease
 * shortens the Redis-tier blob's expiry to
 * {@link BLOB_RELEASE_GRACE_TTL_SECONDS} so lazy does not mean four days.
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

  /**
   * Records this holder's lease on a blob, re-arming the full backstop on the
   * blob itself. Acquiring and renewing are the same write — a deadline of
   * `now + lease TTL` — so both names route through {@link writeLease}; they
   * stay separate only to keep the intent legible at the call site.
   *
   * Re-arming matters beyond refreshing a long-lived blob: it is what lets the
   * release path shorten an unleased blob's expiry safely. A take that landed
   * after such a release restores the backstop under the new holder.
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
   * Retires one holder's lease. When it was the last one, the blob's expiry
   * drops to the release grace window instead of keeping the full backstop.
   *
   * `tier` decides whether there is a Redis key to expire at all — an s3-tier
   * blob's bytes are the durable store's to reclaim, so only its bookkeeping
   * keys are shortened.
   *
   * Resolves true when the grace window was applied, which is the signal that
   * this release actually retired the blob rather than one of several holders.
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
   * The lease set, the rolling-deploy guard set, and — for the redis tier only —
   * the blob itself, prefixed by the key count the Lua `#KEYS` branches read.
   * The s3 tier deliberately passes two keys so cluster mode never has to
   * co-slot a blob key that does not exist.
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
    const keys = [
      this.leaseKey({ projectId, hash }),
      this.legacyHolderKey({ projectId, hash }),
    ];
    if (tier === "redis") {
      keys.push(redisBlobKey({ queueName: this.queueName, projectId, hash }));
    }
    return [keys.length, ...keys];
  }

  /**
   * Moves a lease from a retired value to its replacement in one eval. When the
   * retired lease was the OLD blob's last, that blob goes onto the grace window
   * — `oldTier` says whether there are bytes in Redis to shorten. A retry whose
   * re-encode kept the content hash transfers within one lease set, so the
   * replacement is already recorded and the window is withheld.
   *
   * Resolves true when the old blob went onto the grace window.
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

  /**
   * Records the dead-letter itself as a holder of the blob, for the length of
   * the quarantine window (#719/#720).
   *
   * A quarantined value is a real future reader of that blob, so it takes a real
   * lease rather than a bare TTL bump. Two independent mechanisms reclaim an
   * *unleased* blob back to {@link BLOB_RELEASE_GRACE_TTL_SECONDS}, and a bumped
   * TTL survives neither:
   *
   * - release time — `gqGraceExpireIfUnleased` runs on the job's own
   *   `release()`, which lands immediately AFTER this call in the drop path; and
   * - the maintenance sweep — `blobSweepLua`'s `repaired` branch, which
   *   independently shortens any blob whose TTL exceeds the grace window.
   *
   * Both gate on the LEASE SET being non-empty (`ZCARD`), and the sweep does not
   * consult the legacy holder set at all — so a lease member is the only thing
   * that holds a blob past the grace window. Without it the dead-letter entry
   * (7 days) outlives the blob it references (1 hour) and a drain recovers an
   * envelope pointing at nothing, which is the exact failure #720 exists to
   * prevent.
   *
   * `ttlSeconds` sets the deadline AND the physical expiries, which is why this
   * cannot route through `take`/`renew`: `TAKE_LUA` takes the caller's ttl for
   * the sorted-set member's score but bakes `BLOB_LEASE_SET_TTL_SECONDS` /
   * `BLOB_BACKSTOP_TTL_SECONDS` into its `EXPIRE`s, so the blob would still be
   * reclaimed on the routine schedule no matter what window was asked for.
   *
   * One constant holder token, not a per-entry id: the window is per-blob, so
   * re-quarantining the same blob must move one deadline rather than accumulate
   * members that outlive their entries. Everything then expires together at the
   * window — bounded, and no orphan beyond it. s3-tier objects have no
   * per-object Redis TTL (left to the bucket lifecycle, ADR-029), so only the
   * lease bookkeeping is extended for that tier — the `tier` param mirrors
   * `renew`'s.
   */
  async holdForDlq({
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
    await holdForDlqScript.run(
      this.redis,
      ...this.blobKeyArgs({ projectId, hash, tier }),
      DLQ_LEASE_HOLDER_ID,
      String(ttlSeconds),
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
