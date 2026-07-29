/**
 * Shared SQL fragments for reading `simulation_runs`.
 *
 * `simulation_runs` is the fact table behind both individual scenario runs and
 * every batch-level aggregate derived from them (ADR-072), so the dedup
 * predicate has more than one caller and lives here rather than in whichever
 * repository happened to need it first.
 */

export const SIMULATION_RUNS_TABLE = "simulation_runs" as const;

/**
 * Returns an IN-tuple dedup predicate for simulation_runs.
 *
 * simulation_runs uses ReplacingMergeTree(UpdatedAt) with dedup key
 * (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId). This predicate
 * resolves dedup using only lightweight key columns in the inner GROUP BY,
 * avoiding the per-row dedup anti-pattern which materializes ALL columns
 * per granule (~8K rows).
 *
 * @param whereFilters - The same WHERE filters from the outer query,
 *   duplicated here for partition pruning in the inner subquery.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple Dedup"
 */
export function simulationRunDedupPredicate(whereFilters: string): string {
  return `AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
    SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
    FROM ${SIMULATION_RUNS_TABLE}
    WHERE ${whereFilters}
    GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
  )`;
}
