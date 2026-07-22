import { BLOB_RELEASE_GRACE_TTL_SECONDS } from "./blobConstants";

/**
 * Lua definition of `gqGraceExpireIfUnleased`, shared verbatim by every script
 * that retires a lease — the standalone release/transfer evals in
 * `blobLeases.ts` and the dedup-squash release inlined into `STAGE_LUA` in
 * `scripts.ts`. One definition, so a release path cannot drift into leaving the
 * full backstop on a blob the others would have put on the grace window.
 *
 * Callers must have already removed their own lease member and pruned expired
 * deadlines; the helper decides only whether anything is left.
 *
 * Returns 1 when the grace window was applied, 0 when it was withheld.
 */
export const GQ_BLOB_GRACE_LUA = `
local function gqGraceExpireIfUnleased(leaseKey, legacyKey, blobKey)
  if redis.call("ZCARD", leaseKey) > 0 then return 0 end
  -- Any member beyond the migration sentinel is a holder this blob's lease set
  -- cannot see: a pod from a release that predates leases, or a lease that
  -- expired without its mirrored token being removed. Leave it the full
  -- backstop rather than shorten a deadline under a reader we can't measure.
  -- The threshold counts that one sentinel; LEGACY_HOLDER_LEASE_GUARD is the
  -- only non-holder member gqTakeLease writes into this set.
  if redis.call("SCARD", legacyKey) > 1 then return 0 end
  if blobKey ~= "" then
    redis.call("EXPIRE", blobKey, ${BLOB_RELEASE_GRACE_TTL_SECONDS})
  end
  redis.call("EXPIRE", legacyKey, ${BLOB_RELEASE_GRACE_TTL_SECONDS})
  return 1
end
`;
