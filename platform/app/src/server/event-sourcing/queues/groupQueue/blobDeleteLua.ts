/**
 * The verdicts {@link BLOB_OPERATOR_DELETE_LUA} can return.
 *
 * `missing` is not an error: the operator asked for a blob that had already
 * expired or been reclaimed, and the stale lease and holder keys were dropped
 * anyway. Only `leased` is a refusal.
 */
export const BLOB_DELETE_OUTCOMES = ["leased", "deleted", "missing"] as const;

export type BlobDeleteOutcome = (typeof BLOB_DELETE_OUTCOMES)[number];

/**
 * Deletes ONE blob by hand, refusing atomically if anything still references it.
 *
 * The lease check has to happen inside the same script as the delete. Reading
 * the lease set from Node and then issuing UNLINK leaves a window where a job
 * stages the same content between the two, and the operator's delete lands on a
 * blob that had acquired a reference since it was inspected — the one path that
 * could take bytes out from under a live job. The sweeper never does this: it
 * decides and acts in one eval, and a hand delete has no business being weaker
 * than the automated pass.
 *
 * Unlike the sweeper this ignores TTL entirely. That is the point of the
 * operator path — the blob is being destroyed early, on purpose — so the only
 * question it may ask is whether anything still holds it.
 *
 * All three keys carry the queue's hash tag, so they co-slot and this is a
 * legal cluster eval.
 *
 * KEYS: [1] lease ZSET, [2] legacy holder SET, [3] blob bytes
 * Returns: [outcome, liveLeases] — the count is 0 unless the outcome is leased.
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
