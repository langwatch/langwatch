import {
  bindIdentifiers,
  type ClickHouseClient,
  ch,
  createRowCodec,
} from "@langwatch/clickhouse";
import { experimentRunItemsTable } from "./table";

/**
 * "A run's totals are a query over its items, never counters on the run row"
 * (ADR-103 decision 1) — so a late item changes the answer on the next call.
 *
 * `totalDirectCost` sums only what the items recorded for themselves; pricing
 * an item from its trace lives in `experiments-v3/execution`, on top of this.
 *
 * `occurredAtRange` bounds the outer scope only, for partition pruning — never
 * the dedup scope, because nothing guarantees `OccurredAt` is identical across
 * a logical item's redeliveries.
 */

export interface ExperimentRunTotals {
  readonly completedCount: number;
  readonly failedCount: number;
  /** `completedCount + failedCount`, one reading of the same query. */
  readonly progress: number;
  /** `null` when no item carried a duration, distinct from a total of 0. */
  readonly totalDurationMs: number | null;
  /** `null` until at least one evaluator result carries a score. */
  readonly avgScoreBps: number | null;
  /** `null` until at least one evaluator result carries a graded verdict. */
  readonly passRateBps: number | null;
  readonly scoreCount: number;
  readonly gradedCount: number;
  readonly passedCount: number;
  /** `TargetCost` + `EvaluationCost` over the run's items. */
  readonly totalDirectCost: number;
}

/**
 * Each column is the wire type its expression returns: `countIf` is a
 * non-null `UInt64`, a `sumIf` over a `Nullable` column is nullable and is
 * `NULL` — not 0 — when nothing matched, and summing a rounded `Float64`
 * stays a `Float64` however integral its values are.
 */
const SUMMARY_COLUMNS = {
  completedCount: ch.uint64(),
  failedCount: ch.uint64(),
  durationSumMs: ch.nullable(ch.uint64()),
  durationCount: ch.uint64(),
  scoreSumBps: ch.nullable(ch.float64()),
  scoreCount: ch.uint64(),
  gradedCount: ch.uint64(),
  passedCount: ch.uint64(),
  totalDirectCost: ch.nullable(ch.float64()),
} as const;

type SummaryColumnName = keyof typeof SUMMARY_COLUMNS;
const SUMMARY_COLUMN_NAMES = Object.keys(
  SUMMARY_COLUMNS,
) as readonly SummaryColumnName[];
const SUMMARY_WIRE_COLUMNS = SUMMARY_COLUMN_NAMES.map(
  (name) => SUMMARY_COLUMNS[name],
);
type SummaryRow = {
  readonly [K in SummaryColumnName]: bigint | number | null;
};

interface TotalsQuery {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

export function buildExperimentRunTotalsQuery(args: {
  readonly tenantId: string;
  readonly runId: string;
  readonly experimentId: string;
  readonly occurredAtRange?: { readonly from: Date; readonly to: Date };
}): TotalsQuery {
  const names = bindIdentifiers();
  const table = names.of(experimentRunItemsTable.name);
  type Column = keyof typeof experimentRunItemsTable.columns & string;
  const at = (prefix: string, name: Column) => `${prefix}${names.of(name)}`;
  const col = (name: Column) => at("t.", name);
  const keyList = (prefix: string) =>
    experimentRunItemsTable.sortKey.map((name) => at(prefix, name)).join(", ");
  const scope = (prefix: string) =>
    `WHERE ${at(prefix, "TenantId")} = {tenantId:String} ` +
    `AND ${at(prefix, "RunId")} = {runId:String} ` +
    `AND ${at(prefix, "ExperimentId")} = {experimentId:String}`;

  const outerRange = args.occurredAtRange
    ? `AND ${col("OccurredAt")} >= {occurredAtFrom:DateTime64(3)} ` +
      `AND ${col("OccurredAt")} <= {occurredAtTo:DateTime64(3)} `
    : "";

  const isTarget = `${col("ResultType")} = 'target'`;
  const isGraded =
    `${col("ResultType")} = 'evaluator' AND ${col("EvaluationStatus")} = 'processed'`;
  const errored =
    `${col("TargetError")} IS NOT NULL AND ${col("TargetError")} != ''`;

  const sql =
    `SELECT ` +
    `countIf(${isTarget} AND NOT (${errored})) AS completedCount, ` +
    `countIf(${isTarget} AND ${errored}) AS failedCount, ` +
    `sumIf(${col("TargetDurationMs")}, ${isTarget} AND ${col("TargetDurationMs")} IS NOT NULL) AS durationSumMs, ` +
    `countIf(${isTarget} AND ${col("TargetDurationMs")} IS NOT NULL) AS durationCount, ` +
    `sumIf(round(${col("Score")} * 10000), ${isGraded} AND ${col("Score")} IS NOT NULL) AS scoreSumBps, ` +
    `countIf(${isGraded} AND ${col("Score")} IS NOT NULL) AS scoreCount, ` +
    `countIf(${isGraded} AND ${col("Passed")} IS NOT NULL) AS gradedCount, ` +
    `countIf(${isGraded} AND ${col("Passed")} = 1) AS passedCount, ` +
    `sumIf(${col("TargetCost")}, ${isTarget} AND ${col("TargetCost")} IS NOT NULL) + ` +
    `sumIf(${col("EvaluationCost")}, ${col("ResultType")} = 'evaluator' AND ${col("EvaluationCost")} IS NOT NULL) AS totalDirectCost ` +
    `FROM ${table} AS t ` +
    `${scope("t.")} ` +
    outerRange +
    `AND (${keyList("t.")}, ${col("OccurredAt")}) IN (` +
    `SELECT ${keyList("")}, max(${names.of("OccurredAt")}) ` +
    `FROM ${table} ` +
    `${scope("")} ` +
    `GROUP BY ${keyList("")})`;

  return {
    sql,
    params: {
      ...names.params,
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
  };
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
  const query = buildExperimentRunTotalsQuery(args);
  const result = await args.client.query({
    tenantId: args.tenantId,
    sql: query.sql,
    params: query.params,
  });

  const row = result.rows[0];
  if (!row) return emptyTotals();

  const [decoded] = createRowCodec().decodeRows<SummaryRow>({
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
  const scoreSumBps = Number(decoded.scoreSumBps ?? 0);

  return {
    completedCount,
    failedCount,
    progress: completedCount + failedCount,
    totalDurationMs:
      durationCount > 0 ? Number(decoded.durationSumMs ?? 0) : null,
    avgScoreBps: scoreCount > 0 ? Math.round(scoreSumBps / scoreCount) : null,
    passRateBps:
      gradedCount > 0 ? Math.round((passedCount / gradedCount) * 10000) : null,
    scoreCount,
    gradedCount,
    passedCount,
    totalDirectCost: Number(decoded.totalDirectCost ?? 0),
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
