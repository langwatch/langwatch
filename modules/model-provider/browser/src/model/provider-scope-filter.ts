/**
 * The page's scope filter, read off the address and applied to rows. The URL contract and
 * ambient resolution live in `@langwatch/authz-browser`; this module adds only the fan over rows
 * that carry several scopes, which a provider row and a default-model config both do.
 */

import {
  isScopeInFilter,
  resolveScopeFilter,
  type ResolvedScopeFilter,
  type ScopeFilterValue,
  type ScopeHierarchy,
} from "@langwatch/authz-browser-kit";

/**
 * Re-exported so the rest of this package imports the authz surface from one place instead of
 * naming it in every file (which `ui-screen-closure` would count separately).
 */
export type { ScopeFilterValue, ScopeHierarchy };

/** A row the filter narrows: anything that attaches to one or more scopes. */
type RowWithScopes = { scopes?: { scopeType: string; scopeId: string }[] };

/** The current team and project the two ambient filter kinds resolve against. */
export type AmbientScope = {
  currentTeamId?: string | null;
  currentProjectId?: string | null;
};

/**
 * The filter as the row predicate sees it, ambient kinds already resolved.
 * Exported so a caller with a different row shape resolves once and asks
 * `isScopeInFilter` itself.
 */
export function resolveRowFilter(
  filter: ScopeFilterValue,
  ambient: AmbientScope,
): ResolvedScopeFilter {
  return resolveScopeFilter(filter, ambient);
}

/**
 * Rows whose scopes sit on the same branch of the org tree as the filter.
 * A row with no scopes at all is dropped by a specific filter and kept by
 * "all", matching the platform util: `[].some(...)` is `false`.
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
