/**
 * ADR-092 §2 — the one resolver. Pure functions over a CollectedGrants
 * snapshot: COLLECT happens in collector.ts (Prisma), everything here is
 * deterministic and unit-testable without a database.
 *
 * Stage-A contract: reproduce today's tRPC-path semantics EXACTLY, one
 * implementation replacing five. Deliberate legacy quirks are tagged
 * `LEGACY-QUIRK(<stage>)` with the migration stage that removes them —
 * the shadow comparison (shadow.ts) depends on this file matching legacy
 * behaviour, warts and all.
 */
import {
  bindingScopeCanGrantPermission,
  permissionSatisfiedBy,
  type ShareableResourceKind,
} from "./registry";
import {
  builtinRoleGrants,
  builtinRolePermissions,
  roleKeyForTeamRole,
} from "./roles";

// ============================================================================
// Types
// ============================================================================

/**
 * Mirror Prisma's enums as plain string unions so this package stays
 * Prisma-free. The app-side collector assigns the generated enum values into
 * these directly; a new enum member added in the schema surfaces as a type
 * error at that seam, never silently here.
 */
export type TeamUserRole = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
export type RoleBindingScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export type AuthzScopeRef =
  | { type: "project"; id: string; teamId: string; organizationId: string }
  | { type: "team"; id: string; organizationId: string }
  | { type: "organization"; id: string }
  /**
   * ADR-092 §8 — the resource tier. One shareable resource under its
   * project; `parents` lists shareable ancestors (a trace inside a shared
   * thread), most specific first. Children (spans, logs, metrics…) never
   * appear here — a child read authorizes AT its parent resource's node,
   * which is how one grant covers them all.
   */
  | {
      type: "resource";
      kind: ShareableResourceKind;
      id: string;
      parents?: ReadonlyArray<{ kind: ShareableResourceKind; id: string }>;
      /**
       * Share-link tokens the request presented (ADR-057). Possession is the
       * gate: the collector only surfaces token-backed grants when their
       * token was presented, so a share row alone never authorizes and
       * trace-id guessing stays closed.
       */
      shareTokens?: readonly string[];
      projectId: string;
      teamId: string;
      organizationId: string;
    };

export type AuthzPrincipalRef =
  | { type: "user"; id: string }
  | { type: "apiKey"; id: string }
  /** A caller with no session at all — resolvable only by resource grants
   *  with the `anyone` audience (and the demo project). */
  | { type: "anonymous" };

/**
 * ADR-092 §8 — who a resource grant is for. Principals as everywhere, plus
 * membership sets (no enumeration — matched against the caller's collected
 * grants) and `anyone`, which is the public share expressed as a row.
 */
export type GrantAudience =
  | { kind: "user"; id: string }
  | { kind: "group"; id: string }
  | { kind: "apiKey"; id: string }
  | { kind: "project"; id: string }
  | { kind: "team"; id: string }
  | { kind: "organization"; id: string }
  | { kind: "anyone" };

/** A grant at the resource tier. Matched on (kind, id, projectId) — the
 *  project anchor prevents cross-project resource-id collisions. */
export type ResourceGrant = {
  kind: ShareableResourceKind;
  id: string;
  projectId: string;
  permission: string;
  audience: GrantAudience;
};

export type CollectedBinding = {
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  /** Present when the binding arrived via a group membership. */
  viaGroupId?: string | null;
};

export type LegacyTeamMembership = {
  teamId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  isPersonal: boolean;
};

/**
 * Everything the engine needs to answer any question about one principal in
 * one organization. Produced by collector.ts (or the stage-F cache).
 */
export type CollectedGrants = {
  principal: AuthzPrincipalRef;
  organizationId: string;
  /** Null for api-key principals and for users with no OrganizationUser row. */
  organizationRole: "ADMIN" | "MEMBER" | "EXTERNAL" | null;
  /** True when an OrganizationUser row exists for a user principal. */
  isOrgMember: boolean;
  bindings: CollectedBinding[];
  /**
   * LEGACY-QUIRK(B): TeamUser rows, consulted only when `bindings` is empty
   * (users migrated before role bindings existed). Deleted in stage B.
   */
  legacyTeamMemberships: LegacyTeamMembership[];
  /** Custom-role permission lists, prefetched for every referenced id. */
  customRolePermissions: ReadonlyMap<string, readonly string[]>;
};

export type AuthzDenialReason =
  | "no-membership"
  | "no-binding"
  | "lite-member-restricted"
  | "owner-ceiling";

export type AuthzGrantVia =
  | "binding"
  | "org-role-floor"
  | "demo-project"
  | "legacy-team-fallback"
  | "resource-grant";

export type AuthzDecision = {
  allowed: boolean;
  permission: string;
  scope: AuthzScopeRef;
  principal: AuthzPrincipalRef;
  via?: AuthzGrantVia;
  matchedBinding?: CollectedBinding;
  denialReason?: AuthzDenialReason;
  /** ADR-092 §8 — serialisers redact on this. */
  audience: "member" | "public";
};

// ============================================================================
// Scope chain
// ============================================================================

/** The organization a scope belongs to, whatever its tier. */
export function scopeOrganizationId(scope: AuthzScopeRef): string {
  return scope.type === "organization" ? scope.id : scope.organizationId;
}

/** The binding scopes that can grant at `scope`, most specific first. */
export function scopeChain(
  scope: AuthzScopeRef,
): Array<{ scopeType: RoleBindingScopeType; scopeId: string }> {
  switch (scope.type) {
    case "project":
      return [
        { scopeType: "PROJECT", scopeId: scope.id },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "team":
      return [
        { scopeType: "TEAM", scopeId: scope.id },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
    case "organization":
      return [{ scopeType: "ORGANIZATION", scopeId: scope.id }];
    case "resource":
      // Bindings can grant at any ancestor of the resource's project; the
      // resource links themselves are matched against ResourceGrants, not
      // RoleBindings (see the resource-grant step in decide()).
      return [
        { scopeType: "PROJECT", scopeId: scope.projectId },
        { scopeType: "TEAM", scopeId: scope.teamId },
        { scopeType: "ORGANIZATION", scopeId: scope.organizationId },
      ];
  }
}

/**
 * ADR-092 §8 — does a resource grant's audience include this caller? The
 * membership audiences are matched against the caller's collected grants
 * rather than enumerated members. Two v1 proxies, both documented for the
 * C5 storage pass to replace with direct membership probes: group audiences
 * are visible only through group-derived bindings, and team/project
 * audiences through a binding (or legacy row) at that scope.
 */
function audienceMatches({
  audience,
  grants,
}: {
  audience: GrantAudience;
  grants: CollectedGrants;
}): boolean {
  switch (audience.kind) {
    case "anyone":
      return true;
    case "user":
      return (
        grants.principal.type === "user" && grants.principal.id === audience.id
      );
    case "apiKey":
      return (
        grants.principal.type === "apiKey" &&
        grants.principal.id === audience.id
      );
    case "group":
      return grants.bindings.some(
        (binding) => binding.viaGroupId === audience.id,
      );
    case "organization":
      return grants.isOrgMember && grants.organizationId === audience.id;
    case "team":
      return (
        grants.bindings.some(
          (binding) =>
            binding.scopeType === "TEAM" && binding.scopeId === audience.id,
        ) ||
        grants.legacyTeamMemberships.some((row) => row.teamId === audience.id)
      );
    case "project":
      return grants.bindings.some(
        (binding) =>
          binding.scopeType === "PROJECT" && binding.scopeId === audience.id,
      );
  }
}

// ============================================================================
// Single-binding evaluation (the one copy of the rules)
// ============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat, ordered sequence of legacy grant rules (fence → org-scoped semantics → custom role → EXTERNAL cap → built-in bag) whose ORDER is the stage-A parity contract; the score counts the guards, and splitting them would scatter the one place the rules read top to bottom.
function bindingGrants({
  binding,
  grants,
  permission,
}: {
  binding: Pick<CollectedBinding, "role" | "customRoleId" | "scopeType">;
  grants: CollectedGrants;
  permission: string;
}): boolean {
  // ADR-021 fence: a team/project binding never grants an org-exclusive
  // permission, even through a custom role that lists it.
  if (
    !bindingScopeCanGrantPermission({
      scopeType: binding.scopeType,
      permission,
    })
  ) {
    return false;
  }

  // Org-scoped non-CUSTOM bindings have their own semantics: ADMIN grants
  // everything, anything else grants the org-member bag only.
  // LEGACY-QUIRK(C): role meaning depends on binding scope until roleKey.
  if (binding.scopeType === "ORGANIZATION" && binding.role !== "CUSTOM") {
    // LEGACY-QUIRK(C): EXTERNAL users are never promoted through org-scoped
    // bindings — OrganizationUser.role is authoritative for the restriction.
    if (grants.organizationRole === "EXTERNAL") return false;
    if (binding.role === "ADMIN") return true;
    return builtinRoleGrants({ role: "org-member", permission });
  }

  // Non-empty custom role is authoritative; empty/missing falls through.
  if (binding.customRoleId) {
    const customPermissions = grants.customRolePermissions.get(
      binding.customRoleId,
    );
    if (customPermissions && customPermissions.length > 0) {
      return permissionSatisfiedBy({
        granted: new Set(customPermissions),
        requested: permission,
      });
    }
  }

  // LEGACY-QUIRK(C): EXTERNAL caps team/project bindings at the lite-member
  // bag unless a non-empty custom role overrode it above.
  if (grants.organizationRole === "EXTERNAL") {
    return builtinRoleGrants({ role: "lite-member", permission });
  }

  return builtinRoleGrants({
    role: roleKeyForTeamRole(binding.role),
    permission,
  });
}

/**
 * LEGACY-QUIRK(B) — the TeamUser fallback step of the walk. Project/team
 * checks consult the chain's team only when the principal has ZERO bindings
 * on the chain (rbac.ts:765); organization checks union every non-personal
 * membership on ANY denial, even when org-scoped bindings exist
 * (rbac.ts:1094-1110). Both respect the ADR-021 fence via TEAM-scoped
 * evaluation.
 */
function legacyTeamFallbackGrants({
  grants,
  scope,
  chain,
  chainBindingCount,
  permission,
}: {
  grants: CollectedGrants;
  scope: AuthzScopeRef;
  chain: ReturnType<typeof scopeChain>;
  chainBindingCount: number;
  permission: string;
}): boolean {
  if (scope.type !== "organization" && chainBindingCount > 0) return false;
  const candidateTeams =
    scope.type === "organization"
      ? grants.legacyTeamMemberships.filter((row) => !row.isPersonal)
      : grants.legacyTeamMemberships.filter((row) =>
          chain.some(
            (link) => link.scopeType === "TEAM" && link.scopeId === row.teamId,
          ),
        );
  return candidateTeams.some((row) =>
    bindingGrants({
      binding: {
        role: row.role,
        customRoleId: row.customRoleId,
        scopeType: "TEAM",
      },
      grants,
      permission,
    }),
  );
}

/**
 * ADR-092 §8 — the resource-tier step of the walk: a grant sitting on the
 * resource itself or a shareable ancestor (a trace inside a shared thread)
 * that carries the permission and includes this caller, matched on
 * (kind, id, projectId) plus audience. The ONLY path an anonymous
 * principal can take.
 *
 * When several grants match, the least-redacting audience wins: any
 * membership audience beats `anyone`, so a signed-in member who follows a
 * public link still gets the member view. Picking the first row instead
 * would make `decision.audience` depend on database row order.
 */
function matchResourceGrant({
  scope,
  resourceGrants,
  grants,
  permission,
}: {
  scope: Extract<AuthzScopeRef, { type: "resource" }>;
  resourceGrants: readonly ResourceGrant[];
  grants: CollectedGrants;
  permission: string;
}): ResourceGrant | undefined {
  const links = [{ kind: scope.kind, id: scope.id }, ...(scope.parents ?? [])];
  const matched = resourceGrants.filter(
    (grant) =>
      grant.projectId === scope.projectId &&
      links.some((link) => link.kind === grant.kind && link.id === grant.id) &&
      permissionSatisfiedBy({
        granted: new Set([grant.permission]),
        requested: permission,
      }) &&
      audienceMatches({ audience: grant.audience, grants }),
  );
  return (
    matched.find((grant) => grant.audience.kind !== "anyone") ?? matched[0]
  );
}

// ============================================================================
// The walk — ADR-092's ordered decision steps, one function each
// ============================================================================

/**
 * What every step of the walk reads. `chain` and `chainBindings` are derived
 * once in decide() because three steps need them and the deny step reports on
 * them.
 */
type DecideContext = {
  grants: CollectedGrants;
  permission: string;
  scope: AuthzScopeRef;
  demoProjectId?: string | null;
  resourceGrants?: readonly ResourceGrant[];
  /** The binding scopes that can grant at `scope`, most specific first. */
  chain: ReturnType<typeof scopeChain>;
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
function demoProjectStep({
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
 * path never authorizes. Api-key principals hold no org membership and are
 * exempt (their path is bindings-only). The resource tier is deliberately
 * outside the gate: share links are how a non-member or an anonymous caller
 * sees anything at all.
 */
function organizationMembershipGateStep({
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
function organizationRoleFloorStep({
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
function bindingsStep({
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
function legacyTeamFallbackStep({
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
function resourceGrantStep({
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
function denyStep({
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

// ============================================================================
// AuthzEngine — the walk
// ============================================================================

/**
 * The one resolver, as a service class (app-layer idiom). Stateless and
 * pure by construction: every method is a function of its arguments alone,
 * so one instance serves any number of callers and tests construct it
 * freely.
 */
export class AuthzEngine {
  decide({
    grants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    grants: CollectedGrants;
    permission: string;
    scope: AuthzScopeRef;
    /** Pass process.env.DEMO_PROJECT_ID; parameterised for purity. */
    demoProjectId?: string | null;
    /** ADR-092 §8 — grants at the resource tier, collected for `scope`'s
     *  resource links (collectResourceGrants). Ignored for non-resource
     *  scopes. */
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const chain = scopeChain(scope);
    const context: DecideContext = {
      grants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
      chain,
      chainBindings: grants.bindings.filter((binding) =>
        chain.some(
          (link) =>
            link.scopeType === binding.scopeType &&
            link.scopeId === binding.scopeId,
        ),
      ),
      base: {
        permission,
        scope,
        principal: grants.principal,
        audience: "member",
      },
    };

    // The order IS the contract — each step answers or defers to the next.
    return (
      demoProjectStep(context) ??
      organizationMembershipGateStep(context) ??
      organizationRoleFloorStep(context) ??
      bindingsStep(context) ??
      legacyTeamFallbackStep(context) ??
      resourceGrantStep(context) ??
      denyStep(context)
    );
  }

  /**
   * ADR-092 §9 — the API-key owner ceiling as engine algebra:
   * effective(key) = grants(key) ∩ grants(owner). Service keys (no owner)
   * have no ceiling.
   */
  decideWithCeiling({
    keyGrants,
    ownerGrants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    keyGrants: CollectedGrants;
    ownerGrants: CollectedGrants | null;
    permission: string;
    scope: AuthzScopeRef;
    demoProjectId?: string | null;
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const keyDecision = this.decide({
      grants: keyGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (!keyDecision.allowed || !ownerGrants) return keyDecision;

    const ownerDecision = this.decide({
      grants: ownerGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (ownerDecision.allowed) return keyDecision;

    return {
      ...keyDecision,
      allowed: false,
      via: undefined,
      matchedBinding: undefined,
      denialReason: "owner-ceiling",
    };
  }

  // ============================================================================
  // explain — ADR-092 §6, the decision object rendered as a walk
  // ============================================================================

  private explainBindingLine({
    binding,
    chain,
    decision,
  }: {
    binding: CollectedBinding;
    chain: ReturnType<typeof scopeChain>;
    decision: AuthzDecision;
  }): string {
    const who = binding.viaGroupId ? ` (via group ${binding.viaGroupId})` : "";
    const label = `${binding.customRoleId ? `custom:${binding.customRoleId}` : binding.role.toLowerCase()} @ ${binding.scopeType.toLowerCase()} ${binding.scopeId}${who}`;
    const onChain = chain.some(
      (link) =>
        link.scopeType === binding.scopeType &&
        link.scopeId === binding.scopeId,
    );
    if (!onChain) return `  - ${label} — filtered out: not on this scope chain`;
    const matched =
      decision.matchedBinding === binding
        ? "GRANTS the permission"
        : `does not grant ${decision.permission}`;
    return `  - ${label} — ${matched}`;
  }

  explain({
    decision,
    grants,
  }: {
    decision: AuthzDecision;
    grants: CollectedGrants;
  }): string[] {
    const lines: string[] = [];
    const scopeLabel = `${decision.scope.type} ${decision.scope.id}`;
    lines.push(
      `${decision.allowed ? "GRANTED" : "DENIED"} ${decision.permission} @ ${scopeLabel}`,
    );

    if (decision.via === "demo-project") {
      lines.push("granted: demo project (read-only demo-viewer set)");
      return lines;
    }
    if (decision.via === "org-role-floor") {
      lines.push("granted: every organization member holds this permission");
      return lines;
    }
    if (decision.via === "resource-grant") {
      lines.push(
        "granted: a resource-tier grant on this resource (or a shareable ancestor) covers it",
      );
      return lines;
    }

    const chain = scopeChain(decision.scope);
    lines.push(`collected ${grants.bindings.length} binding(s):`);
    for (const binding of grants.bindings) {
      lines.push(this.explainBindingLine({ binding, chain, decision }));
    }
    if (
      grants.bindings.length === 0 &&
      grants.legacyTeamMemberships.length > 0
    ) {
      lines.push(
        `  - legacy team membership fallback consulted (${grants.legacyTeamMemberships.length} team(s))`,
      );
    }
    if (!decision.allowed) {
      lines.push(`denial reason: ${decision.denialReason ?? "unknown"}`);
    }
    return lines;
  }
}
