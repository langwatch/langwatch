/**
 * Client-side scope filter for the model-providers settings page. The list
 * query returns every provider the caller can see across org/team/project;
 * this util just narrows the visible rows based on the active filter at
 * the top of the page. See specs/model-providers/scope-filter.feature.
 */

export type ScopeFilter = "all" | "organization" | "project";

type ProviderWithScopes = {
  scopes?: Array<{ scopeType: string; scopeId: string }>;
};

export function filterProvidersByScope<T extends ProviderWithScopes>(
  providers: T[],
  filter: ScopeFilter,
  projectId: string | undefined,
): T[] {
  if (filter === "all") return providers;
  return providers.filter((provider) => {
    const scopes = provider.scopes ?? [];
    if (filter === "organization") {
      return scopes.some((s) => s.scopeType === "ORGANIZATION");
    }
    // filter === "project"
    if (!projectId) return false;
    return scopes.some(
      (s) => s.scopeType === "PROJECT" && s.scopeId === projectId,
    );
  });
}
