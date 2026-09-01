import type { AvailableScopes, ScopeFilterValue } from "./scope-filter";

/**
 * The scope filter as an ADDRESS, and as a predicate over rows.
 *
 * Harvested from `platform/app/src/hooks/useUrlScopeFilter.ts` and
 * `~/utils/filterProvidersByScope`, minus the parts that were the
 * application's: the router. What is left is pure, which is what lets two
 * packages share it and a test drive it without a browser. Each screen wires
 * these to its own host's route port; the platform hook stays for the settings
 * pages that still use it.
 *
 * ## The URL contract, unchanged
 *
 *   - `?scope=ORGANIZATION:<id>` / `TEAM:<id>` / `PROJECT:<id>` — a specific pick
 *   - absent, malformed, or naming a scope the reader can no longer see — `all`
 *
 * The last case is the one worth keeping: a stale link to a deleted team must
 * read as "everything you can see" rather than rendering "Team: undefined".
 */

/** The org tree a filter is resolved against, as narrow as the resolution needs. */
export type ScopeHierarchy = {
  organization?: { id: string } | null;
  teams?: Array<{ id: string }>;
  projects?: Array<{ id: string; teamId?: string | null }>;
};

/** A filter with the two ambient kinds already resolved against the reader's scope. */
export type ResolvedScopeFilter =
  | { kind: "all" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    };

/** What writing a filter to the address bar does to the `scope` parameter. */
export type ScopeFilterAddressWrite =
  | { kind: "clear" }
  | { kind: "set"; value: string }
  /** The ambient scope the filter names does not exist, so the address is left alone. */
  | { kind: "keep" };

/** The `?scope=` parameter this filter is written as. */
export function scopeFilterAddressWrite(
  next: ScopeFilterValue,
  ambient: { teamId?: string | null; projectId?: string | null },
): ScopeFilterAddressWrite {
  if (next.kind === "all") return { kind: "clear" };
  if (next.kind === "team-current") {
    return ambient.teamId ? { kind: "set", value: `TEAM:${ambient.teamId}` } : { kind: "keep" };
  }
  if (next.kind === "project-current") {
    return ambient.projectId
      ? { kind: "set", value: `PROJECT:${ambient.projectId}` }
      : { kind: "keep" };
  }
  return { kind: "set", value: `${next.scopeType}:${next.scopeId}` };
}

/** The filter a `?scope=` parameter means, given what the reader can see. */
export function scopeFilterFromAddress({
  raw,
  available,
}: {
  raw: string | undefined;
  available: AvailableScopes;
}): ScopeFilterValue {
  if (typeof raw !== "string") return { kind: "all" };
  const separator = raw.indexOf(":");
  if (separator <= 0 || separator === raw.length - 1) return { kind: "all" };
  const scopeType = raw.slice(0, separator);
  const scopeId = raw.slice(separator + 1);
  if (scopeType !== "ORGANIZATION" && scopeType !== "TEAM" && scopeType !== "PROJECT") {
    return { kind: "all" };
  }
  const name =
    scopeType === "ORGANIZATION"
      ? available.organization?.id === scopeId
        ? available.organization.name
        : void 0
      : scopeType === "TEAM"
        ? available.teams.find((team) => team.id === scopeId)?.name
        : available.projects.find((project) => project.id === scopeId)?.name;
  // A scope the org graph no longer offers came from a stale link. Falling back
  // to "all" is what keeps the label from reading "Team: undefined".
  if (name === void 0) return { kind: "all" };
  return { kind: "specific", scopeType, scopeId, name };
}

/** The org tree the predicate below reads, derived from what the reader can see. */
export function scopeHierarchyOf(available: AvailableScopes): ScopeHierarchy {
  return {
    organization: available.organization ? { id: available.organization.id } : null,
    teams: available.teams.map((team) => ({ id: team.id })),
    projects: available.projects.map((project) => ({
      id: project.id,
      teamId: project.teamId ?? null,
    })),
  };
}

/** Resolves the two ambient kinds against the reader's current team and project. */
export function resolveScopeFilter(
  filter: ScopeFilterValue,
  ambient: { currentTeamId?: string | null; currentProjectId?: string | null },
): ResolvedScopeFilter {
  if (filter.kind === "all") return { kind: "all" };
  if (filter.kind === "team-current") {
    return ambient.currentTeamId
      ? { kind: "specific", scopeType: "TEAM", scopeId: ambient.currentTeamId }
      : { kind: "all" };
  }
  if (filter.kind === "project-current") {
    return ambient.currentProjectId
      ? { kind: "specific", scopeType: "PROJECT", scopeId: ambient.currentProjectId }
      : { kind: "all" };
  }
  return { kind: "specific", scopeType: filter.scopeType, scopeId: filter.scopeId };
}

/**
 * Whether a row's scope sits on the same branch of the org tree as the filter.
 *
 * INCLUSIVE in both directions, which is the property that makes the filter
 * useful rather than merely narrow: picking a team keeps the organization rows
 * it inherits from as well as the projects that resolve through it.
 */
export function isScopeInFilter(
  scope: { scopeType: string; scopeId: string },
  filter: ResolvedScopeFilter,
  hierarchy: ScopeHierarchy,
): boolean {
  if (filter.kind === "all") return true;

  const teamOfProject = (projectId: string): string | null =>
    hierarchy.projects?.find((project) => project.id === projectId)?.teamId ?? null;

  if (filter.scopeType === "ORGANIZATION") {
    if (scope.scopeType === "ORGANIZATION") return scope.scopeId === filter.scopeId;
    // Every TEAM and PROJECT on the page belongs to the one organization it
    // loaded, so they are all inside the filtered org's tree.
    return true;
  }

  if (filter.scopeType === "TEAM") {
    if (scope.scopeType === "ORGANIZATION") return true;
    if (scope.scopeType === "TEAM") return scope.scopeId === filter.scopeId;
    if (scope.scopeType === "PROJECT") return teamOfProject(scope.scopeId) === filter.scopeId;
    return false;
  }

  if (scope.scopeType === "ORGANIZATION") return true;
  if (scope.scopeType === "TEAM") {
    const parentTeam = teamOfProject(filter.scopeId);
    return parentTeam !== null && scope.scopeId === parentTeam;
  }
  if (scope.scopeType === "PROJECT") return scope.scopeId === filter.scopeId;
  return false;
}
