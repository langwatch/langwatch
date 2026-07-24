import type { OrGroupAnalysis } from "~/server/app-layer/traces/query-language/queries";

export interface ToggleRouting {
  /**
   * Boolean operator used to glue a newly-added clause to the existing
   * query when no OR group is targeted. Always `"AND"` — cross-field OR
   * is built only by typing in the filter bar, never by clicking a
   * facet row.
   */
  combinator: "AND";
  /**
   * When set, the new value should be spliced into the existing OR
   * group at this location. Liqe-text-coordinate range of the OR
   * LogicalExpression. Only happens for same-field OR (the field is
   * already in a group), never to start a cross-field one.
   */
  orGroupLocation?: { start: number; end: number };
}

/**
 * Decide what happens when a user clicks a facet row to toggle
 * `field:value`. Two cases:
 *
 * 1. The field is already in an OR group → splice the new value into
 *    that group (preserve the OR scope). The first group wins when a
 *    field appears in multiple disjoint groups — picking any single
 *    group is unavoidable, and "first" is the most natural target
 *    because group ids are ordered by where the OR appears in the
 *    AST (so left-most group wins).
 *
 * 2. The field isn't in any OR group → AND-append.
 *
 * Cross-field OR is intentionally NOT reachable from here: it's built
 * only by typing in the filter bar. A facet click on a field that
 * isn't already grouped always AND-appends.
 *
 * Pure function — no React, no Zustand. The caller threads the
 * result through `filterStore.toggleFacet(field, value, result)`.
 * Pulled out of `useFilterSidebarData`'s inline `useCallback` so the
 * routing rule ("first group wins") is unit-testable without rendering
 * the sidebar.
 */
export function routeToggleViaOrGroups({
  analysis,
  field,
}: {
  analysis: OrGroupAnalysis;
  field: string;
}): ToggleRouting {
  const groupIds = analysis.fieldToGroupIds.get(field);
  const groupId = groupIds?.[0];
  const group = groupId
    ? analysis.groups.find((g) => g.id === groupId)
    : undefined;
  if (group) {
    // The field already participates in an OR group — extend that
    // scope rather than starting a new one (this is the same-field
    // OR path for a third-and-beyond value).
    return {
      combinator: "AND",
      orGroupLocation: { start: group.start, end: group.end },
    };
  }
  return { combinator: "AND" };
}
