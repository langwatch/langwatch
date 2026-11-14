/**
 * Query helpers shared by the Experiment run-history ClickHouse repository.
 * Item tables are partitioned by week: keep OccurredAt bounds and exact
 * experiment/run pairs in every read so ClickHouse can prune without matching reused run ids.
 */

import {
  clickhouseRead,
  column,
  type ConditionOps,
  fn,
  param,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { toEpochMs } from "@langwatch/time";

import { OCCURRED_AT_BUFFER_MS } from "../../rules/experiment-run-occurred-at.rules.ts";
import { experimentRunItems as items } from "./clickhouse.experiment-run-items.table.ts";
import { experimentRuns as runs } from "./clickhouse.experiment-runs.table.ts";

export const WARN_OLD_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function computeOccurredAtRangeForRuns(
  runRows: { CreatedAt: string; UpdatedAt: string }[],
): {
  minMs: number;
  /** The bounds above as epoch millis, inclusive both ends, for a built read. */
  fromMs: number;
  untilMs: number;
} {
  if (runRows.length === 0) {
    throw new Error("computeOccurredAtRangeForRuns called with no runs; caller must guard");
  }

  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const run of runRows) {
    minMs = Math.min(minMs, parseClickHouseDateTime(run.CreatedAt));
    maxMs = Math.max(maxMs, parseClickHouseDateTime(run.UpdatedAt));
  }

  return {
    minMs,
    fromMs: minMs - OCCURRED_AT_BUFFER_MS,
    untilMs: maxMs + OCCURRED_AT_BUFFER_MS,
  };
}

function parseClickHouseDateTime(value: string): number {
  return toEpochMs(`${value.replace(" ", "T")}Z`);
}

/** Whether the tenant's target holds a column (NO-HOLDS); a bare client holds every one. */
export type ColumnHolds = (name: string) => boolean;

/** The run row as a list or lookup reads it: times as ClickHouse text, renamed off the columns. */
export interface RunReadRow {
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Total: number;
  Progress: number;
  Targets: string;
  CreatedAtText: string;
  UpdatedAtText: string;
  FinishedAtText: string | null;
  StoppedAtText: string | null;
  RecordedTargetResults: number | string | null;
  RecordedEvaluatorResults: number | string | null;
  RecordedConcurrency: number | string | null;
}

/** A run row under the column names the run mapping was written against. */
export interface ExperimentRunRow {
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Total: number;
  Progress: number;
  Targets: string;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;
  ExpectedTargetResults: number | string | null;
  ExpectedEvaluatorResults: number | string | null;
  Concurrency: number | string | null;
}

/** One run item as the items read answers it. */
export interface RunItemReadRow {
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  RowIndex: number;
  TargetId: string;
  ResultType: string;
  DatasetEntry: string;
  Predicted: string | null;
  TargetCost: number | null;
  TargetDurationMs: number | null;
  TargetError: string | null;
  TargetDomainError: string | null;
  TraceId: string | null;
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null;
  EvaluationDetails: string | null;
  EvaluationCost: number | null;
  EvaluationInputs: string | null;
  EvaluationDurationMs: number | null;
}

/** The read row under the column names the run mapping was written against. */
export function runRowOf(row: RunReadRow): ExperimentRunRow {
  return {
    TenantId: row.TenantId,
    RunId: row.RunId,
    ExperimentId: row.ExperimentId,
    WorkflowVersionId: row.WorkflowVersionId,
    Total: row.Total,
    Progress: row.Progress,
    Targets: row.Targets,
    CreatedAt: row.CreatedAtText,
    UpdatedAt: row.UpdatedAtText,
    FinishedAt: row.FinishedAtText,
    StoppedAt: row.StoppedAtText,
    ExpectedTargetResults: row.RecordedTargetResults,
    ExpectedEvaluatorResults: row.RecordedEvaluatorResults,
    Concurrency: row.RecordedConcurrency,
  };
}

/** Goose 00105/00125's columns read as NULL where the target lacks them (NO-HOLDS). */
function runRowColumns(holds: ColumnHolds) {
  return {
    TenantId: runs.TenantId,
    RunId: runs.RunId,
    ExperimentId: runs.ExperimentId,
    WorkflowVersionId: runs.WorkflowVersionId,
    Total: runs.Total,
    Progress: runs.Progress,
    Targets: runs.Targets,
    CreatedAtText: fn.toString(runs.CreatedAt),
    UpdatedAtText: fn.toString(runs.UpdatedAt),
    FinishedAtText: fn.toString(runs.FinishedAt),
    StoppedAtText: fn.toString(runs.StoppedAt),
    RecordedTargetResults: fn.heldOr(runs.ExpectedTargetResults, {
      holds,
      otherwise: fn.nullAs(column.nullable(column.uint32())),
    }),
    RecordedEvaluatorResults: fn.heldOr(runs.ExpectedEvaluatorResults, {
      holds,
      otherwise: fn.nullAs(column.nullable(column.uint32())),
    }),
    RecordedConcurrency: fn.heldOr(runs.Concurrency, {
      holds,
      otherwise: fn.nullAs(column.nullable(column.uint16())),
    }),
  };
}

/** The latest version of every run of `experimentIds`, newest first, at most 10,000. */
export function runsOfExperimentsRead({
  projectId,
  experimentIds,
  holds,
}: {
  projectId: string;
  experimentIds: readonly string[];
  holds: ColumnHolds;
}): ReaderReadStatement<RunReadRow> {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(runs)
    .select(runRowColumns(holds))
    .where(({ idBound }) => idBound(runs.ExperimentId, [...experimentIds]))
    .latestVersion()
    .orderBy(runs.CreatedAt, "DESC")
    .limit(10_000)
    .build();
}

/** One page of an experiment's runs, latest version each, by `(CreatedAt, RunId)` descending. */
export function runsPageRead({
  projectId,
  experimentId,
  holds,
  pageSize,
  offset,
}: {
  projectId: string;
  experimentId: string;
  holds: ColumnHolds;
  pageSize: number;
  offset: number;
}): ReaderReadStatement<RunReadRow> {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(runs)
    .select(runRowColumns(holds))
    .where(({ idBound }) => idBound(runs.ExperimentId, experimentId))
    .latestVersion()
    .orderBy(runs.CreatedAt, "DESC")
    .orderBy(runs.RunId, "DESC")
    .limit(pageSize)
    .offset(offset)
    .build();
}

/** How many distinct runs an experiment has, versions not collapsed: uniqExact counts ids. */
export function runCountRead({
  projectId,
  experimentId,
}: {
  projectId: string;
  experimentId: string;
}): ReaderReadStatement<{ totalHits: number | string }> {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(runs)
    .select({ totalHits: fn.uniqExact(runs.RunId) })
    .where(({ idBound }) => idBound(runs.ExperimentId, experimentId))
    .build();
}

/** One run's latest version. */
export function runRead({
  projectId,
  experimentId,
  runId,
  holds,
}: {
  projectId: string;
  experimentId: string;
  runId: string;
  holds: ColumnHolds;
}): ReaderReadStatement<RunReadRow> {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(runs)
    .select(runRowColumns(holds))
    .where(({ and, eq, idBound }) =>
      and(eq(runs.ExperimentId, experimentId), idBound(runs.RunId, runId)),
    )
    .latestVersion()
    .limit(1)
    .build();
}

/** Per experiment: how many runs, and when the newest was created (each run's latest version). */
export function runAggregatesRead({
  projectId,
  experimentIds,
}: {
  projectId: string;
  experimentIds: readonly string[];
}): ReaderReadStatement<{
  ExperimentId: string;
  runsCount: number | string;
  lastRunAt: number | string | null;
}> {
  const scope = tenantScope.single({ tenantId: projectId });
  const heads = clickhouseRead({ scope })
    .from(runs)
    .select({
      TenantId: runs.TenantId,
      ExperimentId: runs.ExperimentId,
      RunCreatedAt: fn.argMax(runs.CreatedAt, runs.UpdatedAt),
    })
    .where(({ idBound }) => idBound(runs.ExperimentId, [...experimentIds]))
    .groupBy(runs.TenantId, runs.ExperimentId, runs.RunId)
    .as("run_heads");
  return clickhouseRead({ scope })
    .from(heads)
    .select({
      ExperimentId: heads.ExperimentId,
      runsCount: fn.count(),
      lastRunAt: fn.max(fn.toUnixTimestamp64Milli(heads.RunCreatedAt)),
    })
    .groupBy(heads.ExperimentId)
    .build();
}

/** The dedup key of a run item: one cell of the board, whatever its projection id. */
const itemKey = () =>
  [
    items.ExperimentId,
    items.RunId,
    items.RowIndex,
    items.TargetId,
    items.ResultType,
    fn.ifNull(items.EvaluatorId, ""),
  ] as const;

/**
 * One run's items, the latest `OccurredAt` per cell, by the IN-tuple pattern; the run and the
 * `OccurredAt` window narrow the election and the read alike, so the week partitions prune.
 */
export function runItemsRead({
  projectId,
  experimentId,
  runId,
  fromMs,
  untilMs,
}: {
  projectId: string;
  experimentId: string;
  runId: string;
  fromMs: number;
  untilMs: number;
}): ReaderReadStatement<RunItemReadRow> {
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(items)
    .with("latest", (sub) =>
      sub
        .from(items)
        .select({ Elected: fn.tuple(...itemKey(), fn.max(items.OccurredAt)) })
        .where(({ and, eq, gte, lte }) =>
          and(
            eq(items.ExperimentId, experimentId),
            eq(items.RunId, runId),
            gte(items.OccurredAt, fromMs),
            lte(items.OccurredAt, untilMs),
          ),
        )
        .groupBy(...itemKey()),
    )
    .select({
      TenantId: items.TenantId,
      RunId: items.RunId,
      ExperimentId: items.ExperimentId,
      RowIndex: items.RowIndex,
      TargetId: items.TargetId,
      ResultType: items.ResultType,
      DatasetEntry: items.DatasetEntry,
      Predicted: items.Predicted,
      TargetCost: items.TargetCost,
      TargetDurationMs: items.TargetDurationMs,
      TargetError: items.TargetError,
      TargetDomainError: items.TargetDomainError,
      TraceId: items.TraceId,
      EvaluatorId: items.EvaluatorId,
      EvaluatorName: items.EvaluatorName,
      EvaluationStatus: items.EvaluationStatus,
      Score: items.Score,
      Label: items.Label,
      Passed: items.Passed,
      EvaluationDetails: items.EvaluationDetails,
      EvaluationCost: items.EvaluationCost,
      EvaluationInputs: items.EvaluationInputs,
      EvaluationDurationMs: items.EvaluationDurationMs,
    })
    .where(({ and, eq, gte, lte, oneOf }) =>
      and(
        eq(items.ExperimentId, experimentId),
        eq(items.RunId, runId),
        gte(items.OccurredAt, fromMs),
        lte(items.OccurredAt, untilMs),
        oneOf(fn.tuple(...itemKey(), items.OccurredAt), { cte: "latest" }),
      ),
    )
    .orderBy(items.RowIndex, "ASC")
    .orderBy(items.ResultType, "ASC")
    .build();
}

/** The `(experiment, run)` pairs an enrichment read covers, with their `OccurredAt` window. */
export interface RunPairsWindow {
  projectId: string;
  pairs: readonly { ExperimentId: string; RunId: string }[];
  fromMs: number;
  untilMs: number;
}

/** The pairs and window, for both the election and the outer read of an enrichment read. */
function pairsInWindow({ pairs, fromMs, untilMs }: RunPairsWindow) {
  return <Ctes>({ and, gte, lte, oneOf }: ConditionOps<"experiment_run_items", Ctes>) =>
    and(
      gte(items.OccurredAt, fromMs),
      lte(items.OccurredAt, untilMs),
      oneOf(
        fn.tuple(items.ExperimentId, items.RunId),
        fn.arrayZip(
          param.strings(pairs.map((pair) => pair.ExperimentId)),
          param.strings(pairs.map((pair) => pair.RunId)),
        ),
      ),
    );
}
const itemsStart = (projectId: string) =>
  clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) }).from(items);

/** The pairs' items, the latest `OccurredAt` per cell (IN-tuple election over the same window). */
function latestItemsOf(window: RunPairsWindow) {
  return itemsStart(window.projectId).with("latest", (sub) =>
    sub
      .from(items)
      .select({ Elected: fn.tuple(...itemKey(), fn.max(items.OccurredAt)) })
      .where(pairsInWindow(window))
      .groupBy(...itemKey()),
  );
}

/** Per run and evaluator: mean score and pass rate over processed verdicts, carried cells kept. */
export function runBreakdownsRead(window: RunPairsWindow): ReaderReadStatement<{
  ExperimentId: string;
  RunId: string;
  EvaluatorId: string | null;
  ShownEvaluatorName: string | null;
  avgScore: number | null;
  passRate: number | null;
  hasPassedCount: number | string;
}> {
  return latestItemsOf(window)
    .select(({ eq, gt, isNotNull }) => ({
      ExperimentId: items.ExperimentId,
      RunId: items.RunId,
      EvaluatorId: items.EvaluatorId,
      ShownEvaluatorName: fn.max(items.EvaluatorName),
      avgScore: fn.avg(items.Score),
      passRate: fn.if(
        gt(fn.countIf(isNotNull(items.Passed)), 0),
        fn.toNullable(
          fn.divide(fn.countIf(eq(items.Passed, 1)), fn.countIf(isNotNull(items.Passed))),
        ),
        fn.nullAs(column.nullable(column.float64())),
      ),
      hasPassedCount: fn.countIf(isNotNull(items.Passed)),
    }))
    .where(pairsInWindow(window))
    .where(({ and, eq, oneOf }) =>
      and(
        eq(items.ResultType, "evaluator"),
        eq(items.EvaluationStatus, "processed"),
        oneOf(fn.tuple(...itemKey(), items.OccurredAt), { cte: "latest" }),
      ),
    )
    .groupBy(items.ExperimentId, items.RunId, items.EvaluatorId)
    .limit(10_000)
    .build();
}

/**
 * Per run: what its own cells cost and took. `CarriedOver = 0` throughout: a run snapshots the
 * whole board, and a carried cell was paid for by the run that produced it. The breakdown read
 * keeps carried cells, because a pass rate describes the board the run stands for.
 */
export function runCostsRead(window: RunPairsWindow): ReaderReadStatement<{
  ExperimentId: string;
  RunId: string;
  datasetCost: number | null;
  evaluationsCost: number | null;
  datasetAverageCost: number | null;
  datasetAverageDuration: number | null;
  evaluationsAverageCost: number | null;
  evaluationsAverageDuration: number | null;
}> {
  return latestItemsOf(window)
    .select(({ and, eq, isNotNull }) => {
      const own = (resultType: string) =>
        and(eq(items.ResultType, resultType), eq(items.CarriedOver, 0));
      return {
        ExperimentId: items.ExperimentId,
        RunId: items.RunId,
        datasetCost: fn.sumIf(items.TargetCost, own("target")),
        evaluationsCost: fn.sumIf(items.EvaluationCost, own("evaluator")),
        datasetAverageCost: fn.avgIf(
          items.TargetCost,
          and(own("target"), isNotNull(items.TargetCost)),
        ),
        datasetAverageDuration: fn.avgIf(
          items.TargetDurationMs,
          and(own("target"), isNotNull(items.TargetDurationMs)),
        ),
        evaluationsAverageCost: fn.avgIf(
          items.EvaluationCost,
          and(own("evaluator"), isNotNull(items.EvaluationCost)),
        ),
        evaluationsAverageDuration: fn.avgIf(
          items.EvaluationDurationMs,
          and(own("evaluator"), isNotNull(items.EvaluationDurationMs)),
        ),
      };
    })
    .where(pairsInWindow(window))
    .where(({ oneOf }) => oneOf(fn.tuple(...itemKey(), items.OccurredAt), { cte: "latest" }))
    .groupBy(items.ExperimentId, items.RunId)
    .limit(10_000)
    .build();
}
