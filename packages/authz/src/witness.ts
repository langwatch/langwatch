import type { AuthzPermission } from "./registry";
import type { BindingScopeTier } from "./vocabulary";

/**
 * ADR-092 §7 L3 — the authorization witness: a branded proof that a check
 * ALLOWED `permission` at `scope`. A function that takes `Authorized<"project">`
 * instead of a raw projectId cannot be reached by a path that skipped the
 * check — "forgot the permission check" becomes a missing-argument compile
 * error at the caller.
 *
 * The scope is the tier and id the decision was actually made at — exactly
 * what the engine decided over, never lineage the minting site would have to
 * invent. The brand symbol is module-private, so the only factory is
 * `mintWitness`, and that is off the package barrel: the
 * `@langwatch/authz/witness` subpath is for the server runtime only, where
 * the permission seams mint one after a decision they just made. Application
 * code receives witnesses; it never mints them.
 */
const AUTHORIZED_BRAND: unique symbol = Symbol("langwatch.authz.authorized");

export type Authorized<Tier extends BindingScopeTier = BindingScopeTier> = {
  readonly [AUTHORIZED_BRAND]: true;
  readonly permission: AuthzPermission;
  readonly scope: { readonly tier: Tier; readonly id: string };
};

/** @internal — only the server's permission seams may mint witnesses. */
export function mintWitness<Tier extends BindingScopeTier>({
  tier,
  id,
  permission,
}: {
  tier: Tier;
  id: string;
  permission: AuthzPermission;
}): Authorized<Tier> {
  return {
    [AUTHORIZED_BRAND]: true,
    permission,
    scope: { tier, id },
  };
}
