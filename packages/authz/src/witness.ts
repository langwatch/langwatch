import type { AuthzPermission } from "./registry";
import type { BindingScopeTier } from "./vocabulary";

/**
 * ADR-092 §7 L3 — the authorization witness: a branded proof that a check
 * ALLOWED `Permission` at `scope`. A function that takes
 * `Authorized<"project">` instead of a raw projectId cannot be reached by a
 * path that skipped the check — "forgot the permission check" becomes a
 * missing-argument compile error at the caller.
 *
 * The witness is parameterised by BOTH the tier and the permission proved, so
 * a callee can demand proof of exactly the permission it needs: a parameter
 * typed `Authorized<"project", "traces:delete">` will not accept a witness
 * minted for `traces:view` on the same project. Leaving `Permission` at its
 * default proves "some check ran at this tier", which is all the older call
 * sites relied on. The permission also travels at runtime for logging and for
 * a callee that wants to assert it.
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

export type Authorized<
  Tier extends BindingScopeTier = BindingScopeTier,
  Permission extends AuthzPermission = AuthzPermission,
> = {
  readonly [AUTHORIZED_BRAND]: true;
  readonly permission: Permission;
  readonly scope: { readonly tier: Tier; readonly id: string };
};

/** @internal — only the server's permission seams may mint witnesses. */
export function mintWitness<
  Tier extends BindingScopeTier,
  Permission extends AuthzPermission,
>({
  tier,
  id,
  permission,
}: {
  tier: Tier;
  id: string;
  permission: Permission;
}): Authorized<Tier, Permission> {
  return {
    [AUTHORIZED_BRAND]: true,
    permission,
    scope: { tier, id },
  };
}
