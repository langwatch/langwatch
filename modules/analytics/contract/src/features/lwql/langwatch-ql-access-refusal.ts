/**
 * Tells a refusal about access from a refusal about the query. A dashboard widget whose reader
 * may not see cost says so and keeps its place on the board; a widget whose query is broken
 * fails. Both arrive as `lwql_not_permitted`, and the violations tell them apart.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

/** The gates one violation names, or none when it is about the query's shape. */
function missingGatesOf(violation: unknown): readonly string[] {
  if (typeof violation !== "object" || violation === null) return [];
  const { missingGates } = violation as { missingGates?: unknown };
  if (!Array.isArray(missingGates)) return [];
  return missingGates.filter((gate): gate is string => typeof gate === "string");
}

/**
 * What the caller lacks, sorted, when that is all a refusal is about: every violation names its
 * gates. One violation about anything else and the query is refused for anyone, so the answer is
 * empty. Takes `unknown` because a browser reads the violations off a handled error's `meta`.
 */
export function findLangWatchQLMissingGates(violations: unknown): readonly string[] {
  if (!Array.isArray(violations)) return [];
  const gates = new Set<string>();
  for (const violation of violations) {
    const missing = missingGatesOf(violation);
    if (missing.length === 0) return [];
    for (const gate of missing) gates.add(gate);
  }
  return [...gates].toSorted();
}
