/**
 * The API Keys table's scope filter, read off the address and applied to rows.
 *
 * The URL contract, the resolution of the two ambient kinds and the row
 * predicate are `@langwatch/authz-web`'s — the data-governance move harvested
 * them out of `platform/app/src/hooks/useUrlScopeFilter.ts` and
 * `~/utils/filterProvidersByScope` so the packages share one reading of
 * `?scope=` instead of several. What is here is the small part that is this
 * family's: the fan over rows that carry SEVERAL scopes, which is what a key
 * with several role bindings is.
 *
 * IT IS THE SECOND COPY OF THAT FAN, `@langwatch/model-provider-web`'s
 * `provider-scope-filter.ts` being the first, and the two are byte-identical
 * below the docblock. A web package may not import another web package, so the
 * choice is this or a third surface on `@langwatch/authz-web` publishing twenty
 * lines. Recorded rather than acted on: promoting it is a change to a shared
 * package a page move does not own, and it should happen when a third family
 * wants it.
 *
 * The platform util keeps its remaining callers (the default-models table and
 * the model-providers page's own tests), so nothing is repointed.
 */

import {
  isScopeInFilter,
  resolveScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ResolvedScopeFilter,
  type ScopeFilterValue,
  type ScopeHierarchy,
} from "@langwatch/authz-web/surfaces/scope-picker";

/**
 * The `?scope=` address contract, passed through for the one screen that reads
 * and writes it. ONE import statement in the whole module, because
 * `ui-screen-closure` counts import LINES and a separate `export … from` would
 * be a second finding for the same decision.
 */
export { scopeFilterAddressWrite, scopeFilterFromAddress, scopeHierarchyOf };

/**
 * The two shared types, re-exported for this package's own modules.
 *
 * `ui-screen-closure` counts import LINES, so everything in the package that
 * merely needs the TYPES reads them from here, and only the modules that render
 * the surface's components name it again.
 */
export type { ScopeFilterValue, ScopeHierarchy };

/** A row the filter narrows: anything that attaches to one or more scopes. */
type RowWithScopes = { scopes?: Array<{ scopeType: string; scopeId: string }> };

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
