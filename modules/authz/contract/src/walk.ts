import type {
  AuthzDecision,
  AuthzPrincipalRef,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./authz.ts";
/**
 * Ordered decision steps; ORDER lives in AuthzEngine.decide() (engine.ts).
 * Legacy quirks tagged LEGACY-QUIRK(<stage>) (ADR-092 §2).
 */
import { bindingGrants, findResourceGrant } from "./matchers.ts";
import { builtinRoleGrants, builtinRolePermissions } from "./roles.ts";
import type { ScopeChainLink } from "./scope.ts";

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

/**
 * Demo project: any signed-in user gets the demo-viewer bag on the one
 * configured project. Mirrors isDemoProject() (session-backed tRPC only,
 * rbac.ts:1118), so api-key and anonymous principals are excluded too.
 */
export function findDemoProjectStep({
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
 * LEGACY-QUIRK(C): deny non-members outright at binding tiers; resource tier
 * allows share links so non-members + anonymous can see resources.
 */
export function findOrganizationMembershipGateStep({
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
    denialReason: grants.membershipDisabled ? "membership-disabled" : "no-membership",
  };
}

/**
 * LEGACY-QUIRK(C): every org member holds the org-member bag on
 * ORGANIZATION-scope checks regardless of bindings (personal-context floor,
 * rbac.ts:1058). Project/team checks have no floor.
 */
export function findOrganizationRoleFloorStep({
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
 * Non-members never resolve through bindings at any tier; closes resource
 * tier to prevent stale leftover bindings from authorizing.
 */
function principalLacksMembership(grants: CollectedGrants): boolean {
  return grants.principal.type === "user" && !grants.isOrgMember;
}

/** Bindings walk: union across every binding on the scope chain. */
export function findBindingsStep({
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

/** ADR-092 §8 — the resource tier (see findResourceGrant). */
export function findResourceGrantStep({
  grants,
  permission,
  scope,
  resourceGrants,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type !== "resource" || !resourceGrants) return;
  const matched = findResourceGrant({
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

function unreachedDenialReason({
  liteMember,
  hadAnyPath,
}: {
  liteMember: boolean;
  hadAnyPath: boolean;
}): "lite-member-restricted" | "no-binding" | "no-membership" {
  if (liteMember) return "lite-member-restricted";
  return hadAnyPath ? "no-binding" : "no-membership";
}

/** No step granted: name the gate the caller can act on. */
export function denyStep({ grants, chainBindings, base }: DecideContext): AuthzDecision {
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
    denialReason: unreachedDenialReason({
      liteMember: grants.organizationRole === "EXTERNAL",
      hadAnyPath,
    }),
  };
}
