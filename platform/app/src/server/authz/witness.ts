import type { AuthzDecision, AuthzScopeRef } from "./engine";

/**
 * ADR-092 §7 L3 — the authorization witness: a branded, unforgeable proof
 * that `authz.require()` allowed `permission` at `scope`. Repositories that
 * adopt the witness convention take `Authorized<"project">` instead of a raw
 * projectId, which makes "forgot the permission check" fail to compile.
 *
 * The brand symbol is module-private: the only factory is
 * `mintWitness`, and the only caller of that is the authz service.
 */
const AUTHORIZED_BRAND: unique symbol = Symbol("langwatch.authz.authorized");

export type Authorized<S extends AuthzScopeRef["type"]> = {
  readonly [AUTHORIZED_BRAND]: true;
  readonly scope: Extract<AuthzScopeRef, { type: S }>;
  readonly permission: string;
  readonly decision: AuthzDecision;
};

/** @internal — only the authz service may mint witnesses. */
export function mintWitness<S extends AuthzScopeRef["type"]>({
  scope,
  permission,
  decision,
}: {
  scope: Extract<AuthzScopeRef, { type: S }>;
  permission: string;
  decision: AuthzDecision;
}): Authorized<S> {
  return {
    [AUTHORIZED_BRAND]: true,
    scope,
    permission,
    decision,
  };
}
