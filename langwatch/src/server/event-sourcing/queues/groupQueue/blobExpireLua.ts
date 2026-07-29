/**
 * Lua definition of `gqExpireAtLeast` — extend an expiry, never shorten it.
 *
 * Shared verbatim by every script that ARMS a blob's lifetime: the take/renew and
 * transfer evals in `blobLeases.ts`, the dead-letter hold, and the stage-path
 * `gqTakeLease` inlined into `STAGE_LUA` in `scripts.ts`. Deliberately NOT used by
 * the paths that mean to shorten — `GQ_BLOB_GRACE_LUA` and `blobSweepLua`'s
 * `repaired` branch both cut an unleased blob down to the release grace window on
 * purpose, and routing them through this helper would silently disable reclamation.
 *
 * **Why this exists.** A blob is content-addressed, so identical bodies from
 * different jobs share one stored copy and one lease set. Plain `EXPIRE` is
 * last-writer-wins, not max. So a blob held for the 7-day dead-letter quarantine
 * (`BlobLeases.holdForDlq`, #720) had its lease-set key pulled back down to
 * `BLOB_LEASE_SET_TTL_SECONDS` by the very next ordinary `renew` from a SIBLING job
 * that happened to hash the same — and when that key expired, it took the `gq:dlq`
 * lease member with it, so the sweep saw an unleased blob and reclaimed the bytes
 * about three days before the dead-letter entry they belonged to. That is the exact
 * failure #720 exists to prevent, reached through the ordinary path rather than the
 * drop path (found in review of #5853).
 *
 * `EXPIRE key ttl GT` says this in one keyword, but it needs Redis >= 7.0. The Helm
 * chart's redis tag is operator-configurable and production runs ElastiCache, so a
 * hard 7.0 floor is not ours to introduce for one keyword. Reading the current TTL
 * is safe here precisely because it happens INSIDE a script: the whole eval is
 * atomic, so nothing can move the TTL between the read and the write.
 *
 * The two sentinel TTLs are NOT symmetric, and getting them backwards is a leak:
 *
 * - `-2` (no such key) → skip. `EXPIRE` on a missing key is a no-op anyway.
 * - `-1` (key exists, no expiry) → **arm it**. Tempting to read as "infinite, so
 *   longer than any ttl, leave it alone", but every caller here has just created
 *   or re-created the key (`ZADD`/`SADD` immediately above), so `-1` is the
 *   ordinary state of a brand-new key, not a deliberate infinite hold. Skipping it
 *   leaves the key with no expiry at all — forever. `blobSweepLua` reads `-1` the
 *   same way: an anomaly to repair, not a hold to respect.
 */
export const GQ_BLOB_EXPIRE_AT_LEAST_LUA = `
local function gqExpireAtLeast(key, ttlSeconds)
  local cur = redis.call("TTL", key)
  if cur == -2 then return end
  if cur >= 0 and cur >= tonumber(ttlSeconds) then return end
  redis.call("EXPIRE", key, ttlSeconds)
end
`;
