/**
 * `@langwatch/groupqueue` — the Redis implementation of the event-sourcing
 * runtime's `LaneQueue` and `BlobSpool` ports (ADR-108, ADR-110 decision 1).
 * The only entry point; a symbol not re-exported here is unreachable from
 * outside the package.
 */

export {
  BlobTooLargeError,
  DurableStoreRequiredError,
  GroupQueueError,
  InvalidTenantIdError,
} from "./errors";
export { blobKeys, blobRef } from "./redis/blobKeys";
export { CachedLuaScript, type LuaRunner } from "./redis/cachedLuaScript";
export {
  LANE_REGISTRY_KEY,
  type LaneKeys,
  laneKeys,
  tenantInFlightKey,
} from "./redis/laneKeys";
export {
  contentHash,
  DEFAULT_SPOOL_BACKSTOP_TTL_SECONDS,
  DEFAULT_SPOOL_GRACE_TTL_SECONDS,
  DEFAULT_SPOOL_MAX_BYTES,
  DEFAULT_SPOOL_REDIS_TIER_THRESHOLD_BYTES,
  type DurableObjectStore,
  type RedisBlobSpoolOptions,
  redisBlobSpool,
} from "./redis/redisBlobSpool";
export {
  DEFAULT_INLINE_BODY_THRESHOLD_BYTES,
  type RedisLaneQueueOptions,
  redisLaneQueue,
} from "./redis/redisLaneQueue";
