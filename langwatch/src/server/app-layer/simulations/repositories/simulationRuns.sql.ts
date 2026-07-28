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

/**
 * Every status a run can hold once it is over, as a SQL list literal.
 *
 * `STALLED` is one of them since ADR-073 step 2 made it a stored status: a
 * stalled run is a run the `scenarioExecution` process finished, not a run
 * still going that a read happened to be late for. Aggregates that ask "is
 * this over" have to say so in one place, or the same batch reports a
 * different completion depending on which query answered.
 */
export const SIMULATION_TERMINAL_STATUSES = [
  "SUCCESS",
  ...SIMULATION_FAILED_STATUSES,
  "CANCELLED",
] as const;

/** Renders a status list as a SQL `IN` tuple: `'A','B'`. */
export function statusList(
  statuses: readonly string[],
): string {
  return statuses.map((status) => `'${status}'`).join(",");
}
