/**
 * Client-side scope filter for the model-providers settings page. The list
 * query returns every provider the caller can see across org/team/project;
 * this util just narrows the visible rows based on the active filter at
 * the top of the page. See specs/model-providers/scope-filter.feature.
 *
 * Accepts either the legacy 3-state string filter ("all" / "organization"
 * / "project") or the structured `ScopeFilter` shared with the default-
 * models surface — the page picks one filter dropdown and threads its
 * value to both tables on the page.
 */

export type ScopeFilter =
  | "all"
  | "organization"
  | "project"
  | { kind: "all" }
  | { kind: "team-current" }
  | { kind: "project-current" }
  | {
      kind: "specific";
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    };

type ProviderWithScopes = {
  scopes?: Array<{ scopeType: string; scopeId: string }>;
};

export function filterProvidersByScope<T extends ProviderWithScopes>(
  providers: T[],
  filter: ScopeFilter,
  projectId: string | undefined,
): T[] {
  // Normalise legacy string form into the structured filter so we
  // have a single match-on-kind branch below.
  const f: Exclude<ScopeFilter, string> =
    typeof filter === "string"
      ? filter === "all"
        ? { kind: "all" }
        : filter === "organization"
        ? { kind: "specific", scopeType: "ORGANIZATION", scopeId: "" }
        : { kind: "project-current" }
      : filter;

  if (f.kind === "all") return providers;
  return providers.filter((provider) => {
    const scopes = provider.scopes ?? [];
    if (f.kind === "specific") {
      if (f.scopeType === "ORGANIZATION") {
        // "organization" filter matches any provider bound at the org tier,
        // regardless of which org id was picked (legacy behaviour).
        if (f.scopeId === "") {
          return scopes.some((s) => s.scopeType === "ORGANIZATION");
        }
        return scopes.some(
          (s) => s.scopeType === "ORGANIZATION" && s.scopeId === f.scopeId,
        );
      }
      return scopes.some(
        (s) => s.scopeType === f.scopeType && s.scopeId === f.scopeId,
      );
    }
    if (f.kind === "project-current") {
      if (!projectId) return false;
      return scopes.some(
        (s) => s.scopeType === "PROJECT" && s.scopeId === projectId,
      );
    }
    // team-current — providers don't expose a notion of "current team"
    // separate from the org/project, so fall through to "show all rows
    // the caller can see" rather than blank the table.
    return true;
  });
}
