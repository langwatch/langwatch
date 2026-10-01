import { BLOB_RELEASE_GRACE_TTL_SECONDS } from "./blobConstants.ts";

/**
 * Shared Lua: decide whether to apply grace window or full backstop after lease
 * retirement (prevents drift between release paths). Returns 1 if applied, 0 if withheld.
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
