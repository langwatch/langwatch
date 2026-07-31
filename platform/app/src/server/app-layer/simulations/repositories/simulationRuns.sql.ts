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
 * Columns a caller may never narrow the dedup scope on.
 *
 * Every one of them is written by the simulation fold, and the fold's
 * `initState()` seeds `BatchRunId` / `ScenarioSetId` to `""` and `Status` to a
 * pre-run placeholder. A version written before the value was known — or
 * re-written after a projection store miss re-ran `init()` — therefore carries
 * an empty value while still being a real version of the run. Filtering the
 * inner `max(UpdatedAt)` scope on such a column can exclude the version that
 * actually holds the maximum, leaving the group to resolve to a stale version
 * that happens to pass the filter.
 */
const FOLD_WRITTEN_COLUMNS = [
  "ScenarioSetId",
  "BatchRunId",
  "ScenarioId",
  "Status",
  "ArchivedAt",
  "FinishedAt",
] as const;

/**
 * Returns an IN-tuple dedup predicate for simulation_runs.
 *
 * `simulation_runs` is `ReplacingMergeTree(UpdatedAt)` with engine key
 * `ORDER BY (TenantId, ScenarioRunId)` — see
 * `src/server/clickhouse/migrations/00002_create_schema.sql`. That pair, and
 * only that pair, is what ClickHouse collapses versions on, so it is what the
 * inner `GROUP BY` has to use.
 *
 * Grouping WIDER than the engine key — which this helper used to do, on
 * `(TenantId, ScenarioSetId, BatchRunId, ScenarioRunId)` — splits one run's
 * versions across several groups, and every sub-group's `max(UpdatedAt)`
 * satisfies the IN-tuple, so the outer query gets the same run back once per
 * group. It is reachable in the ordinary case, not just under contention: the
 * fold seeds `BatchRunId` and `ScenarioSetId` to `""`, so a message snapshot
 * that lands before the `runStarted` event is persisted with both empty and the
 * started event then fills them in. Two versions, two groups, one run counted
 * twice — inflating scenario counts, batch listings and the free-plan cap.
 *
 * The predicate reads only lightweight key columns in the inner GROUP BY, so
 * heavy columns (Messages.*, RoleCosts, Metadata) are materialised only for the
 * rows the outer query actually returns.
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
 * @param partitionFilters - RANGE predicates on the partition column
 *   (`StartedAt`) only, repeated from the outer WHERE so the inner scan prunes
 *   partitions instead of opening every week including cold storage. Must start
 *   with `AND`.
 *
 *   Nothing else belongs here, and {@link FOLD_WRITTEN_COLUMNS} is rejected
 *   outright. Repeating an equality filter such as
 *   `AND ScenarioSetId IN (...)` inside the dedup scope narrows the scope
 *   itself: the version holding `max(UpdatedAt)` may be one whose fold-written
 *   value is still `""`, so it fails the inner filter, drops out of its own
 *   group, and the group resolves to a stale version that passes — a
 *   non-null, plausible, wrong row that no fallback catches. Narrow on those
 *   columns in the OUTER scope only, and accept that a run whose newest version
 *   lost the value leaves the filtered list.
 * @param alias - Table alias of the outer query, when it has one.
 *   `RUN_COLUMNS` / `LIST_COLUMNS` project `toString(...) AS UpdatedAt`, a
 *   `String` alias that shadows the raw `DateTime64` column; qualifying the
 *   tuple with the alias resolves it back to the column.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple
 *   Dedup", and the checklist entry on filtering a dedup subquery by a movable
 *   column.
 */
export function simulationRunDedupPredicate({
  tenantIdParam,
  partitionFilters = "",
  alias,
}: {
  tenantIdParam: string;
  partitionFilters?: string;
  alias?: string;
}): string {
  // The fragment is concatenated straight after the tenant predicate, so a
  // bare condition (or one starting with OR) would either break the SQL or,
  // worse, widen the inner read past this tenant's rows. Enforced here rather
  // than left to the doc comment above.
  if (partitionFilters.trim() && !/^\s*AND\b/i.test(partitionFilters)) {
    throw new Error(
      `simulationRunDedupPredicate: partitionFilters must start with "AND", got: ${partitionFilters}`,
    );
  }

  const foldWritten = FOLD_WRITTEN_COLUMNS.find((column) =>
    new RegExp(`\\b${column}\\b`).test(partitionFilters),
  );
  if (foldWritten) {
    throw new Error(
      `simulationRunDedupPredicate: partitionFilters must not narrow the dedup ` +
        `scope on ${foldWritten} — it is written by the fold and reverts to an ` +
        `empty value on re-init, so filtering versions by it resolves the group ` +
        `to a stale version. Filter on it in the outer WHERE only. Got: ${partitionFilters}`,
    );
  }

  const qualifier = alias ? `${alias}.` : "";

  return `AND (${qualifier}TenantId, ${qualifier}ScenarioRunId, ${qualifier}UpdatedAt) IN (
    SELECT TenantId, ScenarioRunId, max(UpdatedAt)
    FROM ${SIMULATION_RUNS_TABLE}
    WHERE TenantId = {${tenantIdParam}:String} ${partitionFilters}
    GROUP BY TenantId, ScenarioRunId
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
