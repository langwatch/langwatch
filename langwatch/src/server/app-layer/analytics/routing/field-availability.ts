/**
 * Source-classification for analytics metric keys — ADR-034 Phase 3/6.
 *
 * Every routing decision in `pickAnalyticsTable` needs to know whether the
 * metric reads off the trace or evaluation pipeline (picks the right
 * `<source>_analytics{,_rollup}` table + the right legacy fallback +
 * source-groups candidate triggers in the heartbeat).
 *
 * NB: an earlier iteration of this module carried a `FIELD_AVAILABILITY`
 * map keyed by ES field path with per-destination column references
 * (`rollup.column`, `slim.column`, `legacy.column`). No consumer ever
 * read the column data — the slim + rollup query-builders hardcode their
 * own switch-on-metric-key column mappings — so the map was deleted in
 * simp5012-001 / s5014-004. `getMetricSource` remains: it's the ONLY
 * piece of this file the router + heartbeat actually consult.
 */

/** The upstream pipeline whose fold a metric reads from. */
export type AnalyticsMetricSource = "trace" | "evaluation";

/**
 * Source of a registry metric key (e.g. `"performance.total_cost"` →
 * `"trace"`, `"evaluations.evaluation_score"` → `"evaluation"`).
 *
 * Prefix heuristic on the registry group: `performance.*` / `metadata.*` /
 * `topics.*` / `traces.*` / `models` / `trace_name` are trace-domain;
 * `evaluations.*` is eval-domain.
 *
 * Returns `undefined` when the metric belongs to a group with no fast-path
 * mapping — the router treats those as legacy-only.
 */
export function getMetricSource(
  metricKey: string,
): AnalyticsMetricSource | undefined {
  if (
    metricKey.startsWith("performance.") ||
    metricKey.startsWith("metadata.") ||
    metricKey.startsWith("topics.") ||
    metricKey.startsWith("traces.") ||
    metricKey === "models" ||
    metricKey === "trace_name"
  ) {
    return "trace";
  }
  if (metricKey.startsWith("evaluations.")) {
    return "evaluation";
  }
  return undefined;
}
