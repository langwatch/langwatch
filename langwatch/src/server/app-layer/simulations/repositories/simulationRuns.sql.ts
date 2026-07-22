/**
 * Shared SQL fragments for reading `simulation_runs`.
 *
 * `simulation_runs` is the fact table behind both individual scenario runs and
 * every batch-level aggregate derived from them (ADR-061), so the dedup
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

/**
 * Statuses a run holds once it is over. Terminality is read from `FinishedAt`
 * rather than from this list wherever possible — the fold guarantees Status
 * stays terminal once FinishedAt is set — but the list is needed to tell a
 * failure from a success.
 */
export const SIMULATION_FAILED_STATUSES = [
  "FAILED",
  "FAILURE",
  "ERROR",
  "STALLED",
] as const;

/** Statuses that mean the run never left the queue. */
export const SIMULATION_QUEUED_STATUSES = ["QUEUED", "PENDING"] as const;
