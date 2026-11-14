/**
 * Query helpers shared by the Experiment run-history ClickHouse repository.
 * Item tables are partitioned by week: keep OccurredAt bounds and exact
 * experiment/run pairs in every read so ClickHouse can prune without matching reused run ids.
 */

import {
  clickhouseRead,
  column,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { Temporal, toEpochMs } from "@langwatch/time";

import { OCCURRED_AT_BUFFER_MS } from "../../rules/experiment-run-occurred-at.rules.ts";
import { experimentRunItems as items } from "./clickhouse.experiment-run-items.table.ts";
import { experimentRuns as runs } from "./clickhouse.experiment-runs.table.ts";

export const WARN_OLD_RUN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const RUN_ITEMS_DEDUP_KEY =
  "TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')";

const RUN_ITEMS_SCOPE = `TenantId = {tenantId:String}
          AND OccurredAt >= {minOccurredAt:DateTime64(3)}
          AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
          AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}`;

export function buildDedupedRunItemsWhere({
  extraFilters = [],
}: {
  extraFilters?: string[];
} = {}): string {
  const extra = extraFilters.map((filter) => `\n          AND ${filter}`).join("");

  return `WHERE ${RUN_ITEMS_SCOPE}${extra}
          AND (${RUN_ITEMS_DEDUP_KEY}, OccurredAt) IN (
            SELECT
              ${RUN_ITEMS_DEDUP_KEY},
              max(OccurredAt)
            FROM experiment_run_items
            WHERE ${RUN_ITEMS_SCOPE}
            GROUP BY ${RUN_ITEMS_DEDUP_KEY}
          )`;
}

export function computeOccurredAtRangeForRuns(
  runRows: { CreatedAt: string; UpdatedAt: string }[],
): {
  minOccurredAt: string;
  maxOccurredAt: string;
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
    minOccurredAt: formatClickHouseDateTime(minMs - OCCURRED_AT_BUFFER_MS),
    maxOccurredAt: formatClickHouseDateTime(maxMs + OCCURRED_AT_BUFFER_MS),
    minMs,
    fromMs: minMs - OCCURRED_AT_BUFFER_MS,
    untilMs: maxMs + OCCURRED_AT_BUFFER_MS,
  };
}

function formatClickHouseDateTime(milliseconds: number): string {
  return Temporal.Instant.fromEpochMilliseconds(milliseconds)
    .toString({ fractionalSecondDigits: 3 })
    .replace("T", " ")
    .replace("Z", "");
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
