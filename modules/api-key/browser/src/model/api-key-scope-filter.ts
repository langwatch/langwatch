// API Keys scope filter: URL contract from authz-web. This family's part: fan over rows with
// multiple scopes (keys with multiple bindings). Second copy; model-provider-web has the first.

import {
  isScopeInFilter,
  resolveScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ResolvedScopeFilter,
  type ScopeFilterValue,
  type ScopeHierarchy,
} from "@langwatch/authz-browser-kit";

/**
 * The `?scope=` address contract, passed through for the one screen that
 * reads and writes it. ONE import statement in the module: `ui-screen-closure`
 * counts import LINES, and a second `export … from` would double-count it.
 */
export { scopeFilterAddressWrite, scopeFilterFromAddress, scopeHierarchyOf };

/**
 * The two shared types, re-exported for this package's own modules.
 * `ui-screen-closure` counts import LINES, so anything needing only the
 * types reads them from here; only modules rendering the surface name it again.
 */
export type { ScopeFilterValue, ScopeHierarchy };

/** A row the filter narrows: anything that attaches to one or more scopes. */
type RowWithScopes = { scopes?: { scopeType: string; scopeId: string }[] };

/** The current team and project the two ambient filter kinds resolve against. */
export type AmbientScope = {
  currentTeamId?: string | null;
  currentProjectId?: string | null;
};

/** The filter as the row predicate sees it, ambient kinds already resolved. */
export function resolveRowFilter(
  filter: ScopeFilterValue,
  ambient: AmbientScope,
): ResolvedScopeFilter {
  return resolveScopeFilter(filter, ambient);
}

/**
 * Rows whose scopes sit on the same branch of the org tree as the filter. A
 * row with no scopes is dropped by a specific filter, kept by "all" —
 * `[].some(...)` is `false`, matching the platform util's behavior.
 */
export function filterRowsByScope<T extends RowWithScopes>(
  rows: readonly T[],
  filter: ScopeFilterValue,
  context: AmbientScope & { hierarchy: ScopeHierarchy },
): T[] {
  const resolved = resolveRowFilter(filter, context);
  if (resolved.kind === "all") return [...rows];
  return rows.filter((row) =>
    (row.scopes ?? []).some((scope) => isScopeInFilter(scope, resolved, context.hierarchy)),
  );
}
