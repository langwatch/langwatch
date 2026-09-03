/**
 * Scope breadth order, broadest first: ORGANIZATION reaches the most, then
 * TEAM, then PROJECT. The providers table and the default-models table share
 * this order so an organization-wide row always sits above a team row, which
 * sits above a project row, and rows at the same scope read in name order.
 *
 * A family-local copy of `platform/app/src/utils/scopeBreadth.ts`, which keeps
 * two non-family callers there. `@langwatch/gateway-web` made the same copy for
 * the virtual-key provider picker; a third caller in one more package is the
 * signal that this belongs to the model-provider contract, and moving it there
 * is a change to a package a page move does not own.
 */
export const SCOPE_BREADTH = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
} as const;

export type BreadthScopeType = keyof typeof SCOPE_BREADTH;

/**
 * Breadth rank of one scope type. A type outside the triad (a department or
 * group chip on another surface) sorts after every triad scope rather than
 * throwing, so a shared table never crashes on an unexpected scope kind.
 */
export function scopeBreadthRank(scopeType: string): number {
  return SCOPE_BREADTH[scopeType as BreadthScopeType] ?? SCOPE_BREADTH.PROJECT + 1;
}

/**
 * Breadth rank of a row that carries several scopes: the broadest one it has.
 * A row scoped at both ORGANIZATION and PROJECT ranks by ORGANIZATION. A row
 * with no scopes ranks after every scoped row.
 */
export function broadestScopeRank(scopeTypes: readonly string[]): number {
  if (scopeTypes.length === 0) return SCOPE_BREADTH.PROJECT + 2;
  return Math.min(...scopeTypes.map(scopeBreadthRank));
}
