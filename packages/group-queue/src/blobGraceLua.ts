import { BLOB_RELEASE_GRACE_TTL_SECONDS, LEGACY_HOLDER_LEASE_GUARD } from "./blobConstants.ts";

/**
 * Lua expression counting a holder set's real holders: every member except the
 * migration sentinel. The release grace window and the sweep share it, so a set
 * an old release wrote (one holder, no sentinel) protects the blob in both.
 */
export function realHolderCountLua({ holderKey }: { holderKey: string }): string {
  return `(redis.call("SCARD", ${holderKey}) - redis.call("SISMEMBER", ${holderKey}, "${LEGACY_HOLDER_LEASE_GUARD}"))`;
}

/**
 * Shared Lua: decide whether to apply grace window or full backstop after lease
 * retirement (prevents drift between release paths). Returns 1 if applied, 0 if withheld.
 */
export const GQ_BLOB_GRACE_LUA = `
local function gqGraceExpireIfUnleased(leaseKey, legacyKey, blobKey)
  if redis.call("ZCARD", leaseKey) > 0 then return 0 end
  -- A real holder is one this blob's lease set cannot see: a pod from a release
  -- that predates leases, or a lease that expired without its mirrored token
  -- being removed. Leave it the full backstop rather than shorten a deadline
  -- under a reader we can't measure. The sentinel alone is not a holder.
  if ${realHolderCountLua({ holderKey: "legacyKey" })} > 0 then return 0 end
  if blobKey ~= "" then
    redis.call("EXPIRE", blobKey, ${BLOB_RELEASE_GRACE_TTL_SECONDS})
  end
  redis.call("EXPIRE", legacyKey, ${BLOB_RELEASE_GRACE_TTL_SECONDS})
  return 1
end
`;
