import { bindIdentifiers } from "@langwatch/clickhouse";
import { simulationRunsTable } from "./table";

/**
 * A batch's totals, derived at read time over `simulation_runs` — never
 * incremented counters on a run row (ADR-103 decision 1). Progress and terminal
 * state come off the same `GROUP BY`, so a run can never be finished by one
 * read and still running by another.
 */
export interface BatchAggregate {
  readonly batchRunId: string;
  /**
   * The work enrolled, stamped on every child before dispatch. `max()` rather
   * than `any()`: a landed `BatchTotal` of 0 on an old row never masks the
   * real total a sibling carries.
   */
  readonly expectedTotal: number;
  readonly landedCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly cancelledCount: number;
  readonly runningCount: number;
}

const RUNNING_STATUSES = ["PENDING", "QUEUED", "IN_PROGRESS"];
const FAIL_STATUSES = ["FAILURE", "ERROR", "STALLED"];

/**
 * The dedup `GROUP BY` columns are the table's own declared engine key.
 * Grouping wider than it splits one run's several `ReplacingMergeTree`
 * versions across groups, each satisfying the IN-tuple with its own
 * `max(UpdatedAt)`, so the run is counted once per group.
 */
const DEDUP_KEY_COLUMNS = simulationRunsTable.sortKey;

export interface BatchAggregateQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

/**
 * Which batch a run counts towards is decided on its deduped row, so the
 * `BatchRunId` predicate that counts sits outside the dedup subquery: a run
 * whose older version named another batch must not be counted there too.
 *
 * The dedup itself is bounded by run membership rather than by batch, so it
 * reads only the versions of runs one of these batches ever named — the
 * `max(UpdatedAt)` it elects is still taken over every one of that run's
 * versions, whichever batch each names.
 */
export function buildBatchAggregateQuery(args: {
  readonly tenantId: string;
  readonly batchRunIds: readonly string[];
}): BatchAggregateQuery {
  const names = bindIdentifiers();
  const table = names.of(simulationRunsTable.name);
  const tenant = names.of("TenantId");
  const status = names.of("Status");
  const batchRunId = names.of("BatchRunId");
  const scenarioRunId = names.of("ScenarioRunId");
  const updatedAt = names.of("UpdatedAt");
  const dedupKey = names.list(DEDUP_KEY_COLUMNS);

  const membershipSubquery =
    `SELECT ${scenarioRunId} FROM ${table} ` +
    `WHERE ${tenant} = {tenantId:String} ` +
    `AND ${batchRunId} IN {batchRunIds:Array(String)}`;

  const dedupSubquery =
    `SELECT ${dedupKey}, max(${updatedAt}) ` +
    `FROM ${table} ` +
    `WHERE ${tenant} = {tenantId:String} ` +
    `AND ${scenarioRunId} IN (${membershipSubquery}) ` +
    `GROUP BY ${dedupKey}`;

  const sql =
    `SELECT ` +
    `${batchRunId}, ` +
    `max(${names.of("BatchTotal")}) AS ExpectedTotal, ` +
    `count() AS LandedCount, ` +
    `countIf(${status} = 'SUCCESS') AS PassCount, ` +
    `countIf(${status} IN {failStatuses:Array(String)}) AS FailCount, ` +
    `countIf(${status} = 'CANCELLED') AS CancelledCount, ` +
    `countIf(${status} IN {runningStatuses:Array(String)}) AS RunningCount ` +
    `FROM ${table} ` +
    `WHERE ${tenant} = {tenantId:String} ` +
    `AND (${dedupKey}, ${updatedAt}) IN (\n${dedupSubquery}\n) ` +
    `AND ${batchRunId} IN {batchRunIds:Array(String)} ` +
    `GROUP BY ${batchRunId}`;

  return {
    sql,
    params: {
      ...names.params,
      tenantId: args.tenantId,
      batchRunIds: [...args.batchRunIds],
      failStatuses: FAIL_STATUSES,
      runningStatuses: RUNNING_STATUSES,
    },
  };
}

/** Positional column order {@link buildBatchAggregateQuery}'s `SELECT` emits. */
const RESULT_COLUMNS = [
  "BatchRunId",
  "ExpectedTotal",
  "LandedCount",
  "PassCount",
  "FailCount",
  "CancelledCount",
  "RunningCount",
] as const;

function toNumber(cell: unknown): number {
  return typeof cell === "string" ? Number(cell) : Number(cell ?? 0);
}

export function decodeBatchAggregateRows(
  rows: readonly unknown[][],
): BatchAggregate[] {
  return rows.map((row) => {
    const byName = Object.fromEntries(
      RESULT_COLUMNS.map((name, i) => [name, row[i]]),
    );
    return {
      batchRunId: String(byName.BatchRunId),
      expectedTotal: toNumber(byName.ExpectedTotal),
      landedCount: toNumber(byName.LandedCount),
      passCount: toNumber(byName.PassCount),
      failCount: toNumber(byName.FailCount),
      cancelledCount: toNumber(byName.CancelledCount),
      runningCount: toNumber(byName.RunningCount),
    };
  });
}
