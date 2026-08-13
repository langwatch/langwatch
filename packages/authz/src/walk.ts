/**
 * ADR-092 §2 — the ordered decision steps, one function each. Every step
 * reads the same DecideContext and either answers or defers to the next; the
 * ORDER lives in AuthzEngine.decide() (engine.ts), which is the one place it
 * can be read top to bottom.
 *
 * Deliberate legacy quirks are tagged `LEGACY-QUIRK(<stage>)` with the
 * migration stage that removes them.
 */
import {
  bindingGrants,
  legacyTeamFallbackGrants,
  matchResourceGrant,
} from "./matchers";
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

/**
 * Demo project: any signed-in user gets the demo-viewer bag on the one
 * configured project. Mirrors isDemoProject(), which legacy reaches only from
 * the session-backed tRPC path (rbac.ts:1118) — so api-key and anonymous
 * principals are excluded here too, and an anonymous caller's only path stays
 * the resource tier.
 */
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
 * LEGACY-QUIRK(C): a user with no OrganizationUser row is denied outright at
 * every binding tier — organization (rbac.ts:1016), team, and project
 * (resolveProjectPermissionContext, rbac.ts:1083) all read membership before
 * they read bindings, so a stale binding left by a since-closed cross-org
 * path never authorizes. Api-key principals hold no org membership and pass
 * this gate untouched — past it they may still resolve through bindings or
 * an api-key-audience resource grant. The resource tier is deliberately
 * outside the gate: share links are how a non-member or an anonymous caller
 * sees anything at all.
 */
export function organizationMembershipGateStep({
  grants,
  scope,
  base,
}: DecideContext): AuthzDecision | undefined {
  if (scope.type === "resource") return;
  if (grants.principal.type !== "user" || grants.isOrgMember) return;
  return { ...base, allowed: false, denialReason: "no-membership" };
}

/**
 * LEGACY-QUIRK(C): every org member holds the org-member bag on
 * ORGANIZATION-scope checks regardless of bindings (the personal-context
 * floor, rbac.ts:1058). Applies to org checks only — project/team checks have
 * no floor.
 */
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

/** Bindings walk: union across every binding on the scope chain. */
export function bindingsStep({
  grants,
  permission,
  chainBindings,
  base,
}: DecideContext): AuthzDecision | undefined {
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

/** LEGACY-QUIRK(B): the TeamUser fallback (see legacyTeamFallbackGrants). */
export function legacyTeamFallbackStep({
  grants,
  permission,
  scope,
  chain,
  chainBindings,
  base,
}: DecideContext): AuthzDecision | undefined {
  const granted = legacyTeamFallbackGrants({
    grants,
    scope,
    chain,
    chainBindingCount: chainBindings.length,
    permission,
  });
  if (!granted) return;
  return { ...base, allowed: true, via: "legacy-team-fallback" };
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
  const hadAnyPath =
    grants.isOrgMember ||
    chainBindings.length > 0 ||
    grants.legacyTeamMemberships.length > 0;

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
