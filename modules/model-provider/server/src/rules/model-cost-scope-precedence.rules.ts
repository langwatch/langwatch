import type { ModelCost } from "@langwatch/model-provider-contract";

/**
 * How specific a cost row's scope is. A project row prices the project's spans
 * even when an organization row names the same model, so the most specific
 * scope has to be read first: the matcher takes the first row whose pattern
 * matches, and row order alone would let whichever row was saved last win.
 */
const SCOPE_TIER_RANK: Record<string, number> = {
  PROJECT: 0,
  TEAM: 1,
  ORGANIZATION: 2,
};

/**
 * Orders cost rows most-specific first, newest first within a tier, so the
 * first match in the list is the rate the cascade means.
 */
export function byScopePrecedence(costs: readonly ModelCost[]): ModelCost[] {
  return [...costs].sort(
    (a, b) =>
      (SCOPE_TIER_RANK[a.scopeType] ?? 3) - (SCOPE_TIER_RANK[b.scopeType] ?? 3) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}
