/**
 * Why a published example is not runnable for this caller.
 *
 * The reference publishes every example, runnable or not, and says what each
 * one needs: column permissions in `requires.gates`, LangWatchQL app functions
 * in `requires.functions`. A renderer that prints only one of the two tells a
 * reader an example needs nothing while it still cannot run, which is how
 * someone ends up pasting a statement that comes back refused.
 *
 * @see specs/analytics/lwql-cli-query.feature
 */

interface RequirementsOf {
  available: boolean;
  requires: { gates: readonly string[]; functions: readonly string[] };
}

/**
 * The short label a table cell or a header line carries.
 *
 * `"yes"` when the example runs as published. Otherwise everything it needs,
 * and — when the reference names nothing — the one remaining reason, which is
 * that the project has no LangWatchQL surface at all.
 */
export function runnableLabel(example: RequirementsOf): string {
  if (example.available) return "yes";
  const needs = [...example.requires.gates, ...example.requires.functions];
  return needs.length > 0
    ? `needs ${needs.join(", ")}`
    : "not available on this project";
}
