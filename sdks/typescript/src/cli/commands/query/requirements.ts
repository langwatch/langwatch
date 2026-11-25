/**
 * Why a published example is not runnable for this caller: both `requires.gates` and
 * `requires.functions` are printed, so an example never reads as needing nothing while it cannot
 * run.
 * @see specs/analytics/lwql-cli-query.feature
 */

interface RequirementsOf {
  available: boolean;
  requires: { gates: readonly string[]; functions: readonly string[] };
}

/**
 * The short label a table cell or a header line carries. `"yes"` when the example runs as
 * published. Otherwise everything it needs, and — when the reference names nothing — the one
 * remaining reason, which is that the project has no LangWatchQL surface at all.
 */
export function runnableLabel(example: RequirementsOf): string {
  if (example.available) return "yes";
  const needs = [...example.requires.gates, ...example.requires.functions];
  return needs.length > 0 ? `needs ${needs.join(", ")}` : "not available on this project";
}
