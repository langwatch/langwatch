import {
  BLOB_RECLAIM_TTL_THRESHOLD_SECONDS,
  BLOB_RELEASE_GRACE_TTL_SECONDS,
} from "./blobConstants.ts";

/**
 * The verdicts {@link BLOB_SWEEP_LUA} can return for one blob. Every sweep
 * decision is one of these, so a counter labelled by outcome accounts for the
 * whole keyspace rather than only the interesting half.
 */
export const BLOB_SWEEP_OUTCOMES = [
  /** A live lease still references the blob. Untouched. */
  "leased",
  /** Unleased and holding more than the grace window: expiry shortened to it. */
  "repaired",
  /** Unleased, and on the grace window past the safety margin: bytes deleted. */
  "reclaimed",
  /** The bytes were already gone; only stale lease/holder keys were dropped. */
  "bookkeeping",
  /** Unleased and already counting down inside the margin. Left to expire. */
  "pending",
] as const;

export type BlobSweepOutcome = (typeof BLOB_SWEEP_OUTCOMES)[number];

/**
 * Sweep one blob: REPAIR shortens deadlines safely (never destroys bytes),
 * RECLAIM deletes bytes only when TTL proves blob was unreferenced past safety margin.
 * Atomic cluster eval; ARGV[1]="1" to dry-run.
 */
export const BLOB_SWEEP_LUA = `
local dryRun = ARGV[1] == "1"

local now = redis.call("TIME")
local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)

-- Prune deadlines that have passed before reading liveness, exactly as every
-- other lease query does: an expired member is not a reference.
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
if redis.call("ZCARD", KEYS[1]) > 0 then return "leased" end

local ttl = redis.call("TTL", KEYS[3])

-- -2 is "no such key": the bytes already expired and only bookkeeping is left.
if ttl == -2 then
  if not dryRun then
    redis.call("DEL", KEYS[1])
    redis.call("DEL", KEYS[2])
  end
  return "bookkeeping"
end

if ttl >= 0 and ttl <= ${BLOB_RECLAIM_TTL_THRESHOLD_SECONDS} then
  if not dryRun then
    redis.call("UNLINK", KEYS[3])
    redis.call("DEL", KEYS[1])
    redis.call("DEL", KEYS[2])
  end
  return "reclaimed"
end

-- -1 is "no expiry", which put should make impossible; treat it as the longest
-- possible deadline rather than trusting that invariant from a sweeper.
if ttl == -1 or ttl > ${BLOB_RELEASE_GRACE_TTL_SECONDS} then
  if not dryRun then
    redis.call("EXPIRE", KEYS[3], ${BLOB_RELEASE_GRACE_TTL_SECONDS})
    redis.call("EXPIRE", KEYS[2], ${BLOB_RELEASE_GRACE_TTL_SECONDS})
  end
  return "repaired"
end

return "pending"
`;
