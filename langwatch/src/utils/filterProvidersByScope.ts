/**
 * Client-side scope filter for the model-providers settings page and the
 * Default Models section. Both surfaces render rows that attach to one
 * or more scopes (ORGANIZATION / TEAM / PROJECT); this util narrows the
 * visible rows to the scopes reachable from the active filter.
 *
 * Filter semantics are INCLUSIVE — picking a scope shows everything in
 * its cascade tier, both up (parents the row inherits from) and down
 * (children that resolve through it). Concretely:
 *
 *   - "All you can see": every row visible to the caller.
 *   - "Organization X": every row in X's tree (org row + every team
 *     row + every project row inside the org).
 *   - "Team Y": org rows (parent), team Y, and project rows whose
 *     parent team is Y. Other teams and their projects are hidden.
 *   - "Project Z": org rows, the team containing Z, and project Z
 *     itself. Sibling projects and other teams are hidden.
 *
 * The user can hit ctrl+F if they need a more specific search; this
 * filter just hides rows that don't belong to the current branch of the
 * org tree.
 */

export type ScopeFilter =
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
      name?: string;
    };

export type ScopeHierarchy = {
  organization?: { id: string } | null;
  teams?: Array<{ id: string }>;
  projects?: Array<{ id: string; teamId?: string | null }>;
};

export type FilterContext = {
  hierarchy: ScopeHierarchy;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
};

type ResolvedFilter =
  | { kind: "all" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    };

type Scope = { scopeType: string; scopeId: string };

type ProviderWithScopes = {
  scopes?: Array<Scope>;
};

export function resolveScopeFilter(
  filter: ScopeFilter,
  ctx: Pick<FilterContext, "currentTeamId" | "currentProjectId">,
): ResolvedFilter {
  if (filter.kind === "all") return { kind: "all" };
  if (filter.kind === "team-current") {
    return ctx.currentTeamId
      ? { kind: "specific", scopeType: "TEAM", scopeId: ctx.currentTeamId }
      : { kind: "all" };
  }
  if (filter.kind === "project-current") {
    return ctx.currentProjectId
      ? { kind: "specific", scopeType: "PROJECT", scopeId: ctx.currentProjectId }
      : { kind: "all" };
  }
  return {
    kind: "specific",
    scopeType: filter.scopeType,
    scopeId: filter.scopeId,
  };
}

/**
 * Predicate for "does this scope sit on the same branch of the org tree
 * as the active filter?". Used by both the providers table and the
 * default-models table so they filter consistently.
 */
export function isScopeInFilter(
  scope: Scope,
  filter: ResolvedFilter,
  hierarchy: ScopeHierarchy,
): boolean {
  if (filter.kind === "all") return true;

  const teamOfProject = (projectId: string): string | null => {
    const p = hierarchy.projects?.find((x) => x.id === projectId);
    return p?.teamId ?? null;
  };

  if (filter.scopeType === "ORGANIZATION") {
    if (scope.scopeType === "ORGANIZATION") {
      return scope.scopeId === filter.scopeId;
    }
    // TEAM and PROJECT scopes inside a single-org context are always in
    // the org's tree; the page only loads one org at a time.
    return true;
  }

  if (filter.scopeType === "TEAM") {
    if (scope.scopeType === "ORGANIZATION") return true;
    if (scope.scopeType === "TEAM") return scope.scopeId === filter.scopeId;
    if (scope.scopeType === "PROJECT") {
      return teamOfProject(scope.scopeId) === filter.scopeId;
    }
    return false;
  }

  if (filter.scopeType === "PROJECT") {
    if (scope.scopeType === "ORGANIZATION") return true;
    if (scope.scopeType === "TEAM") {
      const parentTeam = teamOfProject(filter.scopeId);
      return parentTeam !== null && scope.scopeId === parentTeam;
    }
    if (scope.scopeType === "PROJECT") {
      return scope.scopeId === filter.scopeId;
    }
    return false;
  }

  return false;
}

export function filterProvidersByScope<T extends ProviderWithScopes>(
  providers: T[],
  filter: ScopeFilter,
  ctx: FilterContext,
): T[] {
  const resolved = resolveScopeFilter(filter, ctx);
  if (resolved.kind === "all") return providers;
  return providers.filter((p) => {
    const scopes = p.scopes ?? [];
    return scopes.some((s) => isScopeInFilter(s, resolved, ctx.hierarchy));
  });
}
