import type { OrGroupAnalysis } from "@langwatch/trace-contract";

export interface ToggleRouting {
  /**
   * Boolean operator used to glue a newly-added clause to the existing query when no OR
   * group is targeted. Always `"AND"` — cross-field OR is built only by typing in the
   * filter bar, never by clicking a facet row.
   */
  combinator: "AND";
  /**
   * When set, the new value should be spliced into the existing OR group at this
   * location. Liqe-text-coordinate range of the OR LogicalExpression. Only happens for
   * same-field OR (the field is already in a group), never to start a cross-field one.
   */
  orGroupLocation?: { start: number; end: number };
}

/**
 * Decide what happens when a user clicks a facet row to toggle `field:value`. Two
 * cases:
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
  const group = groupId ? analysis.groups.find((g) => g.id === groupId) : undefined;
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
