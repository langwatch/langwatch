import type { ClickHouseClient } from "@langwatch/clickhouse";
import { simulationRunsTable } from "./table";

/**
 * A batch's totals, derived at read time over `simulation_runs` — never
 * incremented counters on a run row (ADR-103 decision 1). There is no
 * `suite_runs` row backing this; the numbers cannot drift because nothing
 * accumulates them, and terminal state (decision 4) is read off the same
 * `GROUP BY` as progress, in the same query, so a run can never be "finished"
 * by one read and "still running" by another.
 */
export interface BatchAggregate {
  readonly batchRunId: string;
  /**
   * The work enrolled, stamped on every child before dispatch (ADR-103
   * decision 3). `max()` over the group rather than `any()`: every child of
   * one batch carries the same `BatchTotal`, so the two agree whenever the
   * data is well-formed, and `max()` degrades gracefully — a landed
   * `BatchTotal` of 0 (a pre-ADR-072 row) never masks a real total a sibling
   * row carries.
   */
  readonly expectedTotal: number;
  readonly landedCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly cancelledCount: number;
  readonly runningCount: number;
}

const RUNNING_STATUSES = ["PENDING", "QUEUED", "IN_PROGRESS"] as const;
const FAIL_STATUSES = ["FAILURE", "ERROR", "STALLED"] as const;

function sqlStringList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

/**
 * The dedup `GROUP BY` columns, derived from the table's own declared sort
 * key rather than hand-typed (ADR-099's engine key, ADR-103 decision 2: "the
 * item table's key is the logical item").
 *
 * This is the read-side half of defect #2. The historical bug
 * (`app-layer/simulations/repositories/simulationRuns.sql.ts`'s
 * `simulationRunDedupPredicate` docblock) was grouping the dedup subquery
 * WIDER than this — `(TenantId, ScenarioSetId, BatchRunId, ScenarioRunId)`
 * instead of `(TenantId, ScenarioRunId)` — which splits one run's several
 * `ReplacingMergeTree` versions across multiple groups (the fold seeds
 * `ScenarioSetId`/`BatchRunId` to `""`, so an early snapshot's version and
 * the `started` event's later version can carry different values for either
 * field). Each sub-group's own `max(UpdatedAt)` then satisfies the IN-tuple,
 * so the SAME run comes back once per group — the outer query double-counts
 * a run that should have collapsed to a single latest row. Deriving the
 * dedup columns from `simulationRunsTable.sortKey` here means widening this
 * scope requires widening the table's declared engine key first, which is a
 * conscious, reviewed change to `table.ts` rather than a string edited in
 * one query.
 */
const DEDUP_KEY_COLUMNS = simulationRunsTable.sortKey;

function buildDedupSubquery(): string {
  return (
    `SELECT ${DEDUP_KEY_COLUMNS.join(", ")}, max(UpdatedAt) ` +
    `FROM ${simulationRunsTable.name} ` +
    `WHERE TenantId = {tenantId:String} ` +
    `GROUP BY ${DEDUP_KEY_COLUMNS.join(", ")}`
  );
}

export interface BatchAggregateQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

/**
 * Builds the batch-totals query for a page of `batchRunIds`.
 *
 * The `BatchRunId` filter is applied in the OUTER scope only, after the
 * dedup IN-tuple — never inside the dedup subquery's `WHERE`/`GROUP BY`.
 * Unlike the old `simulationRunDedupPredicate`, which accepted an arbitrary
 * `partitionFilters` string a caller could (and once did) use to narrow the
 * dedup scope itself, this function takes a closed, structured argument list
 * with nowhere for a caller to inject anything into the inner scope at all —
 * the shape that made the old bug possible does not typecheck here.
 */
export function buildBatchAggregateQuery(args: {
  readonly tenantId: string;
  readonly batchRunIds: readonly string[];
}): BatchAggregateQuery {
  const sql =
    `SELECT ` +
    `BatchRunId, ` +
    `max(BatchTotal) AS ExpectedTotal, ` +
    `count() AS LandedCount, ` +
    `countIf(Status = 'SUCCESS') AS PassCount, ` +
    `countIf(Status IN (${sqlStringList(FAIL_STATUSES)})) AS FailCount, ` +
    `countIf(Status = 'CANCELLED') AS CancelledCount, ` +
    `countIf(Status IN (${sqlStringList(RUNNING_STATUSES)})) AS RunningCount ` +
    `FROM ${simulationRunsTable.name} ` +
    `WHERE TenantId = {tenantId:String} ` +
    `AND (${DEDUP_KEY_COLUMNS.join(", ")}, UpdatedAt) IN (\n${buildDedupSubquery()}\n) ` +
    `AND BatchRunId IN {batchRunIds:Array(String)} ` +
    `GROUP BY BatchRunId`;

  return {
    sql,
    params: { tenantId: args.tenantId, batchRunIds: [...args.batchRunIds] },
  };
}

/** Positional column order `buildBatchAggregateQuery`'s `SELECT` emits. */
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

/** Runs {@link buildBatchAggregateQuery} and decodes the result in one call. */
export async function queryBatchAggregates(args: {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly batchRunIds: readonly string[];
}): Promise<BatchAggregate[]> {
  if (args.batchRunIds.length === 0) return [];
  const query = buildBatchAggregateQuery(args);
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql: query.sql,
    params: query.params,
  });
  return decodeBatchAggregateRows(result.rows);
}
