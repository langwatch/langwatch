/**
 * ADR-092 §2 — the ordered decision steps, one function each. Every step
 * reads the same DecideContext and either answers or defers to the next; the
 * ORDER lives in AuthzEngine.decide() (engine.ts), which is the one place it
 * can be read top to bottom.
 *
 * Deliberate legacy quirks are tagged `LEGACY-QUIRK(<stage>)` with the
 * migration stage that removes them.
 */
import { bindingGrants, matchResourceGrant } from "./matchers";
import { builtinRoleGrants, builtinRolePermissions } from "./roles";
import type { ScopeChainLink } from "./scope";
import type {
  AuthzDecision,
  AuthzPrincipalRef,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./types";

/**
 * What every step of the walk reads. `chain` and `chainBindings` are derived
 * once in decide() because three steps need them and the deny step reports on
 * them.
 */
export type DecideContext = {
  grants: CollectedGrants;
  permission: string;
  scope: AuthzScopeRef;
  demoProjectId?: string | null;
  resourceGrants?: readonly ResourceGrant[];
  /** The binding scopes that can grant at `scope`, most specific first. */
  chain: readonly ScopeChainLink[];
  /** `grants.bindings` filtered to `chain` — the union the walk evaluates. */
  chainBindings: CollectedBinding[];
  /** The fields every decision carries, whatever the verdict. */
  base: {
    permission: string;
    scope: AuthzScopeRef;
    principal: AuthzPrincipalRef;
    audience: "member";
  };
};

/** The demo viewer role is available to signed-in users, never API keys. */
export function demoProjectStep({
  grants,
  permission,
  scope,
  demoProjectId,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type !== "project" || grants.principal.type !== "user") return;
  if (!demoProjectId || scope.id !== demoProjectId) return;
  if (!builtinRolePermissions("demo-viewer").has(permission)) return;
  return { ...base, allowed: true, via: "demo-project" };
}

/**
 * User bindings require active organization membership. Resource grants may
 * authorize non-members or anonymous readers; API keys have their own grants.
 */
export function organizationMembershipGateStep({
  grants,
  scope,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type === "resource") return;
  if (grants.principal.type !== "user" || grants.isOrgMember) return;
  return {
    ...base,
    allowed: false,
    // A disabled membership fails the SAME gate as an absent one - the
    // difference is only what the person is told, and it is a difference
    // they can act on: an admin can re-enable a seat, nobody can re-enable
    // a membership that was never there.
    denialReason: grants.membershipDisabled
      ? "membership-disabled"
      : "no-membership",
  };
}

/** Active members receive the organization-member permissions at org scope. */
export function organizationRoleFloorStep({
  grants,
  permission,
  scope,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type !== "organization" || !grants.isOrgMember) return;
  if (!builtinRoleGrants({ role: "org-member", permission })) return;
  return { ...base, allowed: true, via: "org-role-floor" };
}

/**
 * A user with no OrganizationUser row never resolves through bindings or the
 * legacy team fallback, at ANY tier. Non-resource scopes already denied at
 * the membership gate; this closes the resource tier, where the gate defers
 * so share links stay reachable — without it, a since-removed member's
 * leftover binding on the resource's project/team/org lineage would still
 * authorize a resource read. Api-key principals hold no membership by design
 * and pass.
 */
function principalLacksMembership(grants: CollectedGrants): boolean {
  return grants.principal.type === "user" && !grants.isOrgMember;
}

/** Bindings walk: union across every binding on the scope chain. */
export function bindingsStep({
  grants,
  permission,
  chainBindings,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (principalLacksMembership(grants)) return;
  for (const binding of chainBindings) {
    if (bindingGrants({ binding, grants, permission })) {
      return {
        ...base,
        allowed: true,
        via: "binding",
        matchedBinding: binding,
      };
    }
  }
  return;
}

/** ADR-092 §8 — the resource tier (see matchResourceGrant). */
export function resourceGrantStep({
  grants,
  permission,
  scope,
  resourceGrants,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type !== "resource" || !resourceGrants) return;
  const matched = matchResourceGrant({
    scope,
    resourceGrants,
    grants,
    permission,
  });
  if (!matched) return;
  return {
    ...base,
    allowed: true,
    via: "resource-grant",
    audience: matched.audience.kind === "anyone" ? "public" : "member",
  };
}

/** No step granted: name the gate the caller can act on. */
export function denyStep({
  grants,
  chainBindings,
  base,
}: DecideContext): AuthzDecision {
  // Checked before everything else: a disabled seat is the reason NO path
  // exists, so reporting the absence it causes ("no membership", "no
  // binding") would name the symptom. On a resource scope this is the only
  // step that runs, because the membership gate defers there to keep share
  // links reachable.
  if (grants.membershipDisabled) {
    return { ...base, allowed: false, denialReason: "membership-disabled" };
  }

  const hadAnyPath = grants.isOrgMember || chainBindings.length > 0;

  return {
    ...base,
    allowed: false,
    denialReason:
      grants.organizationRole === "EXTERNAL"
        ? "lite-member-restricted"
        : hadAnyPath
          ? "no-binding"
          : "no-membership",
  };
}
