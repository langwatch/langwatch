import type { Cluster, Redis as IORedis } from "ioredis";

import type { TenantId } from "~/server/event-sourcing/domain/tenantId";
import { BLOB_HOLDER_TTL_SECONDS } from "./blobConstants";
import { blobHolderSetKey, redisBlobKey } from "./blobKeys";

/**
 * Atomic release: drop this slot's hold; if no holders remain, delete the
 * holder set and — for a redis-tier blob — UNLINK the blob in the same eval, so
 * a completion racing a re-stage of the same content can never delete a live
 * blob. A release whose SREM removed nothing (a doubled or never-acquired
 * release) returns early with "still-held" so it can never reclaim on a no-op.
 * The redis blob key is only passed when the tier is redis, so cluster mode
 * never has to co-slot an empty placeholder key. Returns:
 *   0  still held by other slots (or SREM was a no-op)
 *   1  holders emptied, redis blob UNLINKed here
 *   2  holders emptied, s3 object must be reclaimed by the caller
 */
const RELEASE_LUA = `
if redis.call("SREM", KEYS[1], ARGV[1]) == 0 then return 0 end
if redis.call("SCARD", KEYS[1]) == 0 then
  redis.call("DEL", KEYS[1])
  if #KEYS >= 2 then
    redis.call("UNLINK", KEYS[2])
    return 1
  end
  return 2
end
return 0
`;

/**
 * Atomic hold transfer: add the new slot's hold (refreshing its TTL), drop the
 * old slot's, and reclaim the old blob if its holder set is now empty — all in
 * one eval, so a partial failure can't reclaim a live blob the way a separate
 * acquire-then-release pair can. KEYS[1]=new holder set, KEYS[2]=old holder set,
 * KEYS[3]=old redis blob (passed only for the redis tier). Returns the OLD
 * blob's reclaim outcome. A self-transfer (same holder set AND same slot) just
 * refreshes the TTL and keeps the hold; otherwise the old blob is reclaimed only
 * when the SREM actually removed the old slot and the set is now empty, so a
 * no-op transfer can never reclaim a live blob.
 */
const TRANSFER_LUA = `
if KEYS[1] == KEYS[2] and ARGV[1] == ARGV[2] then
  redis.call("SADD", KEYS[1], ARGV[1])
  redis.call("EXPIRE", KEYS[1], ARGV[3])
  return 0
end
redis.call("SADD", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], ARGV[3])
if redis.call("SREM", KEYS[2], ARGV[2]) == 1 and redis.call("SCARD", KEYS[2]) == 0 then
  redis.call("DEL", KEYS[2])
  if #KEYS >= 3 then
    redis.call("UNLINK", KEYS[3])
    return 1
  end
  return 2
end
return 0
`;

export type ReleaseOutcome = "still-held" | "reclaimed-redis" | "reclaim-s3";

/**
 * Reference counting for content-addressed blobs via a per-blob holder set
 * whose members are staged-slot ids. A staged job acquires a hold; each
 * terminal retirement releases it; the last release reclaims the blob. A *set*
 * (not a counter) makes a doubled release a harmless no-op and a missed one
 * degrade to the TTL backstop rather than deleting a live blob. See ADR-029.
 *
 * Holder and blob keys carry the queue's hash tag, so a release/transfer eval's
 * keys (the holder key, plus the blob key only for the redis tier) land in one
 * cluster slot.
 */
export class BlobHolders {
  private readonly redis: IORedis | Cluster;
  private readonly queueName: string;

  constructor({
    redis,
    queueName,
  }: {
    redis: IORedis | Cluster;
    queueName: string;
  }) {
    this.redis = redis;
    this.queueName = queueName;
  }

  private holderKey(projectId: TenantId, hash: string): string {
    return blobHolderSetKey({ queueName: this.queueName, projectId, hash });
  }

  private blobKey(projectId: TenantId, hash: string): string {
    return redisBlobKey({ queueName: this.queueName, projectId, hash });
  }

  /** Records that a staged slot references the blob (idempotent), refreshing the holder TTL. */
  async acquire({
    projectId,
    hash,
    slotId,
  }: {
    projectId: TenantId;
    hash: string;
    slotId: string;
  }): Promise<void> {
    const key = this.holderKey(projectId, hash);
    await this.redis
      .multi()
      .sadd(key, slotId)
      .expire(key, BLOB_HOLDER_TTL_SECONDS)
      .exec();
  }

  /** Refreshes the holder set's TTL on access (dispatch), so it outlives the blob it guards. */
  async touch({
    projectId,
    hash,
  }: {
    projectId: TenantId;
    hash: string;
  }): Promise<void> {
    await this.redis.expire(
      this.holderKey(projectId, hash),
      BLOB_HOLDER_TTL_SECONDS,
    );
  }

  /**
   * Releases a staged slot's hold and reclaims the blob when the last hold
   * drops. For a redis-tier blob the eval UNLINKs it atomically; for s3 the
   * caller deletes the object on a `"reclaim-s3"` outcome.
   */
  async release({
    projectId,
    hash,
    tier,
    slotId,
  }: {
    projectId: TenantId;
    hash: string;
    tier: "redis" | "s3";
    slotId: string;
  }): Promise<ReleaseOutcome> {
    // Pass the blob key only for the redis tier, so cluster mode never has to
    // co-slot an empty placeholder key (ADR-030 §6).
    const keys =
      tier === "redis"
        ? [this.holderKey(projectId, hash), this.blobKey(projectId, hash)]
        : [this.holderKey(projectId, hash)];
    const result = (await this.redis.eval(
      RELEASE_LUA,
      keys.length,
      ...keys,
      slotId,
    )) as number;
    if (result === 1) return "reclaimed-redis";
    if (result === 2) return "reclaim-s3";
    return "still-held";
  }

  /**
   * Atomically moves a hold from a retired value to its replacement (a retry
   * re-encode or a dedup squash). One eval adds the new hold, drops the old, and
   * reclaims the old blob if newly unreferenced — closing the window an
   * acquire-then-release pair leaves, where a partial failure could reclaim a
   * live blob. Returns the OLD blob's reclaim outcome.
   */
  async transfer({
    newProjectId,
    newHash,
    newSlotId,
    oldProjectId,
    oldHash,
    oldTier,
    oldSlotId,
  }: {
    newProjectId: TenantId;
    newHash: string;
    newSlotId: string;
    oldProjectId: TenantId;
    oldHash: string;
    oldTier: "redis" | "s3";
    oldSlotId: string;
  }): Promise<ReleaseOutcome> {
    const newHolderKey = this.holderKey(newProjectId, newHash);
    const oldHolderKey = this.holderKey(oldProjectId, oldHash);
    // Old blob key only for the redis tier (see release()).
    const keys =
      oldTier === "redis"
        ? [newHolderKey, oldHolderKey, this.blobKey(oldProjectId, oldHash)]
        : [newHolderKey, oldHolderKey];
    const result = (await this.redis.eval(
      TRANSFER_LUA,
      keys.length,
      ...keys,
      newSlotId,
      oldSlotId,
      String(BLOB_HOLDER_TTL_SECONDS),
    )) as number;
    if (result === 1) return "reclaimed-redis";
    if (result === 2) return "reclaim-s3";
    return "still-held";
  }
}
