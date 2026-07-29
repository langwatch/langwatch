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
 * THE TENANT PREDICATE IS EMITTED HERE, not passed in. The inner subquery is
 * a full read of `simulation_runs` in its own right — it decides which
 * (run, version) tuples the outer query is allowed to see — so a caller that
 * forgot to repeat `TenantId =` inside it would dedup a tenant's runs against
 * every tenant's rows. Every caller happened to remember, which is precisely
 * the kind of invariant that holds until someone adds the tenth query. The
 * shape now makes forgetting impossible: the tenant binding is named, and the
 * caller's own filters are appended after it.
 *
 * @param tenantIdParam - Name of the ClickHouse query parameter carrying the
 *   tenant id, bound in the same call's `query_params`.
 * @param filters - The rest of the outer query's WHERE filters, repeated here
 *   for partition pruning in the inner subquery. Each must start with `AND`.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple Dedup"
 */
export function simulationRunDedupPredicate({
  tenantIdParam,
  filters = "",
}: {
  tenantIdParam: string;
  filters?: string;
}): string {
  // The fragment is concatenated straight after the tenant predicate, so a
  // bare condition (or one starting with OR) would either break the SQL or,
  // worse, widen the inner read past this tenant's rows. Enforced here rather
  // than left to the doc comment above.
  if (filters.trim() && !/^\s*AND\b/i.test(filters)) {
    throw new Error(
      `simulationRunDedupPredicate: filters must start with "AND", got: ${filters}`,
    );
  }

  return `AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
    SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
    FROM ${SIMULATION_RUNS_TABLE}
    WHERE TenantId = {${tenantIdParam}:String} ${filters}
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
export function statusList(statuses: readonly string[]): string {
  return statuses.map((status) => `'${status}'`).join(",");
}
