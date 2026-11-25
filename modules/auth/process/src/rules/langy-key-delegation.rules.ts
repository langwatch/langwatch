import type { AuthzPermission } from "@langwatch/authorization";
import { classifyForLangy } from "@langwatch/langy-contract";

/**
 * A Langy session key is refused what Langy is never delegated, by the policy itself rather than
 * by whatever grants the key happens to carry.
 */
export function isUndelegatedForLangy(input: {
  /** The key's principal or resolved credential; only a Langy session key carries the flag. */
  key: object;
  permission: AuthzPermission;
}): boolean {
  const { key, permission } = input;
  const isLangy = "isLangySessionKey" in key && key.isLangySessionKey === true;

  return isLangy && classifyForLangy(permission).disposition !== "granted";
}
