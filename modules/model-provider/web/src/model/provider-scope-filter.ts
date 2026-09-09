/**
 * The page's scope filter, read off the address and applied to rows.
 *
 * The URL contract, the resolution of the two ambient kinds and the row
 * predicate are `@langwatch/authz-web`'s — the data-governance move harvested
 * them out of `platform/app/src/hooks/useUrlScopeFilter.ts` and
 * `~/utils/filterProvidersByScope` so two packages share one reading of
 * `?scope=` instead of two. What is here is the small part that is this
 * family's: the fan over rows that carry SEVERAL scopes, which is what a
 * provider row and a default-model config both are.
 *
 * The platform util keeps four non-family callers (the api-keys page and its
 * three tests), so this is a narrowed copy of its last function rather than a
 * repoint.
 */

import {
  isScopeInFilter,
  resolveScopeFilter,
  type ResolvedScopeFilter,
  type ScopeFilterValue,
  type ScopeHierarchy,
} from "@langwatch/authz-web/surfaces/scope-picker";

/**
 * The two shared types, re-exported for this package's own modules.
 *
 * `ui-screen-closure` counts import LINES, and naming the authz surface from
 * four files buys four findings for what is one decision — the data-governance
 * family's lesson, applied the other way round. This module already has to name
 * it for the functions, so everything else in the package reads the types from
 * here and only the screen, which renders the surface's components, names it a
 * second time.
 */
export type { ScopeFilterValue, ScopeHierarchy };

/** A row the filter narrows: anything that attaches to one or more scopes. */
type RowWithScopes = { scopes?: Array<{ scopeType: string; scopeId: string }> };

/** The current team and project the two ambient filter kinds resolve against. */
export type AmbientScope = {
  currentTeamId?: string | null;
  currentProjectId?: string | null;
};

/**
 * The filter as the row predicate sees it, ambient kinds already resolved.
 *
 * Exported so a caller that filters rows of a different shape — the
 * default-models table, whose scopes spell the pair `{ type, id }` — resolves
 * once and asks `isScopeInFilter` itself.
 */
export function resolveRowFilter(
  filter: ScopeFilterValue,
  ambient: AmbientScope,
): ResolvedScopeFilter {
  return resolveScopeFilter(filter, ambient);
}

/**
 * Rows whose scopes sit on the same branch of the org tree as the filter.
 *
 * A row with no scopes at all is dropped by a specific filter and kept by
 * "all", which is what the platform util did: `[].some(...)` is `false`.
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
