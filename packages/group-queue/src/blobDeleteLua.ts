/**
 * The verdicts {@link BLOB_OPERATOR_DELETE_LUA} can return. `missing` is not
 * an error: the blob had already expired or been reclaimed, and the stale
 * lease/holder keys were dropped anyway. Only `leased` is a refusal.
 */
export const BLOB_DELETE_OUTCOMES = ["leased", "deleted", "missing"] as const;

export type BlobDeleteOutcome = (typeof BLOB_DELETE_OUTCOMES)[number];

/**
 * Operator: delete blob atomically if unreferenced (lease check and delete in one eval);
 * ignores TTL since deletion is intentional.
 * Returns: [outcome, liveLeases].
 */
export const BLOB_OPERATOR_DELETE_LUA = `
local now = redis.call("TIME")
local nowMs = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)

-- Prune deadlines that have passed before reading liveness, exactly as every
-- other lease query does: an expired member is not a reference.
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", nowMs)
local live = redis.call("ZCARD", KEYS[1])
if live > 0 then return {"leased", tostring(live)} end

local removed = redis.call("UNLINK", KEYS[3])
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])

if removed > 0 then return {"deleted", "0"} end
return {"missing", "0"}
`;
