import type { OrGroupAnalysis } from "~/server/app-layer/traces/query-language/queries";

export interface ToggleRouting {
  /**
   * Boolean operator used to glue a newly-added clause to the existing
   * query when no OR group is targeted. `"OR"` only when the user
   * explicitly held the modifier (Shift/Ctrl/Cmd) and the field isn't
   * already in an OR group; otherwise default to `"AND"`.
   */
  combinator: "AND" | "OR";
  /**
   * When set, the new value should be spliced into the existing OR
   * group at this location instead of opening a new top-level OR
   * scope. Liqe-text-coordinate range of the OR LogicalExpression.
   */
  orGroupLocation?: { start: number; end: number };
}

/**
 * Decide what happens when a user clicks a facet row to toggle
 * `field:value`. Three cases:
 *
 * 1. The field is already in an OR group → splice the new value into
 *    that group (preserve the OR scope). The first group wins when a
 *    field appears in multiple disjoint groups — picking any single
 *    group is unavoidable, and "first" is the most natural target
 *    because group ids are ordered by where the OR appears in the
 *    AST (so left-most group wins).
 *
 * 2. The field isn't in any OR group, modifier held → start a new
 *    cross-facet OR group at the top level.
 *
 * 3. The field isn't in any OR group, no modifier → AND-append.
 *
 * Pure function — no React, no Zustand. The caller threads the
 * result through `filterStore.toggleFacet(field, value, result)`.
 * Pulled out of `useFilterSidebarData`'s inline `useCallback` so the
 * routing rules ("first group wins", modifier semantics) are
 * unit-testable without rendering the sidebar.
 */
export function routeToggleViaOrGroups({
  analysis,
  field,
  modifierKey,
}: {
  analysis: OrGroupAnalysis;
  field: string;
  modifierKey: boolean;
}): ToggleRouting {
  const groupIds = analysis.fieldToGroupIds.get(field);
  const groupId = groupIds?.[0];
  const group = groupId
    ? analysis.groups.find((g) => g.id === groupId)
    : undefined;
  if (group) {
    // The field already participates in an OR group — extend that
    // scope rather than starting a new one. Modifier is ignored here:
    // the user clicked a value within an OR-grouped facet, the intent
    // is "add this to the same alternative" regardless of how they
    // clicked.
    return {
      combinator: "AND",
      orGroupLocation: { start: group.start, end: group.end },
    };
  }
  return { combinator: modifierKey ? "OR" : "AND" };
}
