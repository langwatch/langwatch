import {
  type AnyWireColumn,
  type ClickHouseClient,
  ch,
  createRowCodec,
} from "@langwatch/clickhouse";
import { EXPERIMENT_RUN_ITEMS_TABLE_NAME } from "./itemsTable";

/**
 * "A run's totals are a query over its items, never counters on the run row"
 * (ADR-103 decision 1) — this is that query, and this pipeline's worked
 * example for it. Everything `aggregate.ts`'s old counterpart used to
 * increment (`Progress`, `CompletedCount`, `FailedCount`, `TotalDurationMs`,
 * `AvgScoreBps`, `PassRateBps`, `TotalScoreSum`, `ScoreCount`, `PassedCount`,
 * `GradedCount`) is computed here instead, from `experiment_run_items`,
 * every time it is asked for. There is no cache and nothing to invalidate —
 * a late item changes the answer on the very next call (the "A late item
 * changes the run immediately" scenario in
 * `specs/experiments-v3/experiment-run-aggregates.feature`), because there
 * is no stored total to have gone stale.
 *
 * `totalDirectCost` sums only what the items themselves recorded
 * (`TargetCost` + `EvaluationCost`) — the "an item that reports its own cost
 * keeps that figure" half of ADR-103's cost story. It deliberately does
 * **not** implement "an item with no cost of its own is priced from its
 * trace" or the even split across targets sharing one trace: that logic
 * reads `experiments-v3/execution`'s trace-cost lookup
 * (`splitTraceCostAcrossTargets`/`fetchTraceCosts`), which lives outside
 * this pipeline's directory and is unchanged by this rewrite. A caller
 * wanting the full customer-facing total adds the trace-priced remainder on
 * top of this function's result, the same layering
 * `enrichRunsWithBreakdownAndCosts` already does today.
 *
 * ## Query shape
 *
 * `experiment_run_items` is `ReplacingMergeTree(OccurredAt)` — unmerged
 * duplicate versions of one `ProjectionId` (a redelivery) can coexist until
 * the next background merge, so this aggregate deliberately deduplicates
 * before counting, following `dev/docs/best_practices/clickhouse-queries.md`'s
 * IN-tuple pattern rather than a bare `GROUP BY`: the inner subquery picks
 * the latest `OccurredAt` per `(TenantId, RunId, ProjectionId)`, and the outer
 * scope aggregates only rows that match it. `occurredAtRange`, when supplied,
 * is applied to the **outer** scope only, for partition pruning — never to
 * the inner dedup scope, because `OccurredAt` is written from the event's own
 * `data.occurredAt` and nothing in this table's contract guarantees it is the
 * same value across every redelivery of a logical item (the doc's own rule:
 * "leave the dedup scope unbounded on that column").
 */

export interface ExperimentRunTotals {
  readonly completedCount: number;
  readonly failedCount: number;
  /** `completedCount + failedCount` — one reading of the same query, never a separate one (ADR-103 decision 4). */
  readonly progress: number;
  /** `null` when no target result carried a duration, distinct from a total of 0. */
  readonly totalDurationMs: number | null;
  /** `null` until at least one evaluator result carries a score. */
  readonly avgScoreBps: number | null;
  /** `null` until at least one evaluator result carries a graded (`passed`) verdict. */
  readonly passRateBps: number | null;
  readonly scoreCount: number;
  readonly gradedCount: number;
  readonly passedCount: number;
  /** Sum of `TargetCost` + `EvaluationCost` over the run's items — see the module docblock for what this excludes. */
  readonly totalDirectCost: number;
}

const SUMMARY_COLUMNS = {
  completedCount: ch.uint64(),
  failedCount: ch.uint64(),
  durationSumMs: ch.uint64(),
  durationCount: ch.uint64(),
  scoreSumBps: ch.uint64(),
  scoreCount: ch.uint64(),
  gradedCount: ch.uint64(),
  passedCount: ch.uint64(),
  totalDirectCost: ch.float64(),
} as const;

type SummaryColumnName = keyof typeof SUMMARY_COLUMNS;
const SUMMARY_COLUMN_NAMES = Object.keys(
  SUMMARY_COLUMNS,
) as readonly SummaryColumnName[];
const SUMMARY_WIRE_COLUMNS: readonly AnyWireColumn[] = SUMMARY_COLUMN_NAMES.map(
  (name) => SUMMARY_COLUMNS[name],
);
type SummaryRow = { readonly [K in SummaryColumnName]: bigint | number };

function buildSql(args: { readonly boundOccurredAt: boolean }): string {
  const outerRange = args.boundOccurredAt
    ? "AND t.OccurredAt >= {occurredAtFrom:DateTime64(3)} AND t.OccurredAt <= {occurredAtTo:DateTime64(3)} "
    : "";

  return (
    "SELECT " +
    "countIf(t.ResultType = 'target' AND (t.TargetError IS NULL OR t.TargetError = '')) AS completedCount, " +
    "countIf(t.ResultType = 'target' AND t.TargetError IS NOT NULL AND t.TargetError != '') AS failedCount, " +
    "sumIf(t.TargetDurationMs, t.ResultType = 'target' AND t.TargetDurationMs IS NOT NULL) AS durationSumMs, " +
    "countIf(t.ResultType = 'target' AND t.TargetDurationMs IS NOT NULL) AS durationCount, " +
    "sumIf(round(t.Score * 10000), t.ResultType = 'evaluator' AND t.EvaluationStatus = 'processed' AND t.Score IS NOT NULL) AS scoreSumBps, " +
    "countIf(t.ResultType = 'evaluator' AND t.EvaluationStatus = 'processed' AND t.Score IS NOT NULL) AS scoreCount, " +
    "countIf(t.ResultType = 'evaluator' AND t.EvaluationStatus = 'processed' AND t.Passed IS NOT NULL) AS gradedCount, " +
    "countIf(t.ResultType = 'evaluator' AND t.EvaluationStatus = 'processed' AND t.Passed = 1) AS passedCount, " +
    "sumIf(t.TargetCost, t.ResultType = 'target' AND t.TargetCost IS NOT NULL) + " +
    "sumIf(t.EvaluationCost, t.ResultType = 'evaluator' AND t.EvaluationCost IS NOT NULL) AS totalDirectCost " +
    `FROM ${EXPERIMENT_RUN_ITEMS_TABLE_NAME} AS t ` +
    "WHERE t.TenantId = {tenantId:String} AND t.RunId = {runId:String} AND t.ExperimentId = {experimentId:String} " +
    outerRange +
    "AND (t.TenantId, t.RunId, t.ProjectionId, t.OccurredAt) IN (" +
    "SELECT TenantId, RunId, ProjectionId, max(OccurredAt) " +
    `FROM ${EXPERIMENT_RUN_ITEMS_TABLE_NAME} ` +
    "WHERE TenantId = {tenantId:String} AND RunId = {runId:String} AND ExperimentId = {experimentId:String} " +
    "GROUP BY TenantId, RunId, ProjectionId" +
    ")"
  );
}

export interface DeriveExperimentRunTotalsArgs {
  readonly client: ClickHouseClient;
  readonly tenantId: string;
  readonly runId: string;
  readonly experimentId: string;
  /** Outer-scope-only partition-pruning bound — see the module docblock. */
  readonly occurredAtRange?: { readonly from: Date; readonly to: Date };
}

export async function deriveExperimentRunTotals(
  args: DeriveExperimentRunTotalsArgs,
): Promise<ExperimentRunTotals> {
  const codec = createRowCodec();
  const boundOccurredAt = args.occurredAtRange !== undefined;

  const result = await args.client.query({
    tenantId: args.tenantId,
    sql: buildSql({ boundOccurredAt }),
    params: {
      tenantId: args.tenantId,
      runId: args.runId,
      experimentId: args.experimentId,
      ...(args.occurredAtRange
        ? {
            occurredAtFrom: args.occurredAtRange.from.toISOString(),
            occurredAtTo: args.occurredAtRange.to.toISOString(),
          }
        : {}),
    },
  });

  const row = result.rows[0];
  if (!row) return emptyTotals();

  const [decoded] = codec.decodeRows<SummaryRow>({
    columns: SUMMARY_WIRE_COLUMNS,
    columnNames: SUMMARY_COLUMN_NAMES,
    header: result.header,
    rows: [row],
  });
  if (!decoded) return emptyTotals();

  const completedCount = Number(decoded.completedCount);
  const failedCount = Number(decoded.failedCount);
  const durationCount = Number(decoded.durationCount);
  const scoreCount = Number(decoded.scoreCount);
  const gradedCount = Number(decoded.gradedCount);
  const passedCount = Number(decoded.passedCount);
  const scoreSumBps = Number(decoded.scoreSumBps);

  return {
    completedCount,
    failedCount,
    progress: completedCount + failedCount,
    totalDurationMs: durationCount > 0 ? Number(decoded.durationSumMs) : null,
    avgScoreBps: scoreCount > 0 ? Math.round(scoreSumBps / scoreCount) : null,
    passRateBps:
      gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null,
    scoreCount,
    gradedCount,
    passedCount,
    totalDirectCost: decoded.totalDirectCost as number,
  };
}

function emptyTotals(): ExperimentRunTotals {
  return {
    completedCount: 0,
    failedCount: 0,
    progress: 0,
    totalDurationMs: null,
    avgScoreBps: null,
    passRateBps: null,
    scoreCount: 0,
    gradedCount: 0,
    passedCount: 0,
    totalDirectCost: 0,
  };
}
