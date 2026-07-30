/**
 * Mapper functions that convert backend-specific data shapes
 * (ClickHouse PascalCase, legacy snake_case) into the
 * canonical camelCase service types.
 */

import type { SerializedHandledError } from "@langwatch/handled-error";
import { parseClickHouseDateTimeMs } from "~/server/clickhouse/dateTime";
import type { ExperimentRunTotals } from "~/server/event-sourcing/experiment-run-processing/totals";
import type { ESBatchEvaluationTarget } from "~/server/experiments/types";
import type {
  ExperimentRun,
  ExperimentRunDatasetEntry,
  ExperimentRunEvaluation,
  ExperimentRunEvaluationSummary,
  ExperimentRunSummary,
  ExperimentRunTarget,
  ExperimentRunWithItems,
  ExperimentRunWorkflowVersion,
} from "./types";

// ---------------------------------------------------------------------------
// ClickHouse row types
// ---------------------------------------------------------------------------

/**
 * Row shape returned from the `experiment_runs` ClickHouse table. The eleven
 * counter columns ADR-103 decision 1 retired are absent: a run's progress is
 * a query over `experiment_run_items` (see `totals.ts`), never a column here.
 * `Total` stays — the denominator is stamped once by the fold and is not a
 * totals concern.
 */
export interface ClickHouseExperimentRunRow {
  ProjectionId: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Version: string;
  Total: number;
  Targets: string;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;
}

/** The exact columns {@link ClickHouseExperimentRunRow} reads, so a query can
 * name them instead of `SELECT *` — a retired column cannot silently return
 * a DDL default that way. */
export const EXPERIMENT_RUN_ROW_COLUMNS = [
  "ProjectionId",
  "TenantId",
  "RunId",
  "ExperimentId",
  "WorkflowVersionId",
  "Version",
  "Total",
  "Targets",
  "CreatedAt",
  "UpdatedAt",
  "FinishedAt",
  "StoppedAt",
] as const satisfies readonly (keyof ClickHouseExperimentRunRow)[];

/** Row shape returned from the `experiment_run_items` ClickHouse table. */
export interface ClickHouseExperimentRunItemRow {
  ProjectionId: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  RowIndex: number;
  TargetId: string;
  ResultType: "target" | "evaluator";
  DatasetEntry: string;
  Predicted: string | null;
  TargetCost: number | null;
  TargetDurationMs: number | null;
  TargetError: string | null;
  /** Serialised handled error (JSON) — the coded half of `TargetError`. */
  TargetDomainError: string | null;
  TraceId: string | null;
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null; // UInt8 in ClickHouse
  EvaluationDetails: string | null;
  EvaluationCost: number | null;
  EvaluationInputs: string | null;
  EvaluationDurationMs: number | null;
  CreatedAt: string;
}

/** The exact columns {@link ClickHouseExperimentRunItemRow} reads — see
 * {@link EXPERIMENT_RUN_ROW_COLUMNS} for why this is named rather than `*`. */
export const EXPERIMENT_RUN_ITEM_ROW_COLUMNS = [
  "ProjectionId",
  "TenantId",
  "RunId",
  "ExperimentId",
  "RowIndex",
  "TargetId",
  "ResultType",
  "DatasetEntry",
  "Predicted",
  "TargetCost",
  "TargetDurationMs",
  "TargetError",
  "TargetDomainError",
  "TraceId",
  "EvaluatorId",
  "EvaluatorName",
  "EvaluationStatus",
  "Score",
  "Label",
  "Passed",
  "EvaluationDetails",
  "EvaluationCost",
  "EvaluationInputs",
  "EvaluationDurationMs",
  "CreatedAt",
] as const satisfies readonly (keyof ClickHouseExperimentRunItemRow)[];

/** Per-evaluator aggregation row from ClickHouse GROUP BY query. */
export interface ClickHouseEvaluatorBreakdownRow {
  ExperimentId: string;
  RunId: string;
  EvaluatorId: string;
  EvaluatorName: string | null;
  avgScore: number | null;
  passRate: number | null;
  hasPassedCount: number;
}

/** Per-run cost/duration summary from ClickHouse aggregate query. */
export interface ClickHouseCostSummaryRow {
  ExperimentId: string;
  RunId: string;
  datasetCost: number | null;
  evaluationsCost: number | null;
  datasetAverageCost: number | null;
  datasetAverageDuration: number | null;
  evaluationsAverageCost: number | null;
  evaluationsAverageDuration: number | null;
}

// ---------------------------------------------------------------------------
// ClickHouse mappers
// ---------------------------------------------------------------------------

/**
 * Maps a ClickHouse `experiment_runs` row to the canonical `ExperimentRun` type.
 *
 * @param record - The ClickHouse row
 * @param workflowVersion - Optional workflow version metadata from Prisma
 * @param evaluatorBreakdown - Optional per-evaluator aggregation rows for this run
 * @param costSummary - Optional per-run cost/duration summary
 * @returns The canonical ExperimentRun
 */
export function mapClickHouseRunToExperimentRun({
  record,
  workflowVersion,
  evaluatorBreakdown,
  costSummary,
  totals,
}: {
  record: ClickHouseExperimentRunRow;
  workflowVersion?: ExperimentRunWorkflowVersion | null;
  evaluatorBreakdown?: ClickHouseEvaluatorBreakdownRow[];
  costSummary?: ClickHouseCostSummaryRow;
  /** Absent when no item has landed yet — distinct from a present zero. */
  totals?: ExperimentRunTotals;
}): ExperimentRun {
  const evaluations: Record<string, ExperimentRunEvaluationSummary> = {};

  if (evaluatorBreakdown) {
    for (const row of evaluatorBreakdown) {
      const summary: ExperimentRunEvaluationSummary = {
        name: row.EvaluatorName ?? row.EvaluatorId,
        averageScore: row.avgScore,
      };
      if (row.hasPassedCount > 0 && row.passRate !== null) {
        summary.averagePassed = row.passRate;
      }
      evaluations[row.EvaluatorId] = summary;
    }
  }

  const summary: ExperimentRunSummary = {
    datasetCost: costSummary?.datasetCost ?? undefined,
    evaluationsCost: costSummary?.evaluationsCost ?? undefined,
    datasetAverageCost: costSummary?.datasetAverageCost ?? undefined,
    datasetAverageDuration: costSummary?.datasetAverageDuration ?? undefined,
    evaluationsAverageCost: costSummary?.evaluationsAverageCost ?? undefined,
    evaluationsAverageDuration:
      costSummary?.evaluationsAverageDuration ?? undefined,
    evaluations,
  };

  return {
    experimentId: record.ExperimentId,
    runId: record.RunId,
    workflowVersion: workflowVersion ?? null,
    timestamps: {
      createdAt: parseClickHouseDateTimeMs(record.CreatedAt),
      updatedAt: parseClickHouseDateTimeMs(record.UpdatedAt),
      finishedAt: record.FinishedAt
        ? parseClickHouseDateTimeMs(record.FinishedAt)
        : null,
      stoppedAt: record.StoppedAt
        ? parseClickHouseDateTimeMs(record.StoppedAt)
        : null,
    },
    progress: totals ? totals.progress : null,
    total: record.Total,
    summary,
  };
}

/**
 * Reads the stored handled error back off a row.
 *
 * Anything unparseable is treated as absent rather than thrown on: a run's
 * results are worth more than the one cell whose code we can't read, and the
 * raw `error` string is still there to fall back on.
 */
function parseDomainError(
  stored: string | null,
): SerializedHandledError | undefined {
  if (!stored) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as SerializedHandledError)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Maps ClickHouse `experiment_runs` and `experiment_run_items` rows
 * into the canonical `ExperimentRunWithItems` type.
 *
 * @param runRecord - The run summary row from experiment_runs
 * @param items - All item rows from experiment_run_items for this run
 * @returns The canonical ExperimentRunWithItems
 */
export function mapClickHouseItemsToRunWithItems({
  runRecord,
  items,
  projectId,
  totals,
}: {
  runRecord: ClickHouseExperimentRunRow;
  items: ClickHouseExperimentRunItemRow[];
  projectId: string;
  /** Absent when no item has landed yet — distinct from a present zero. */
  totals?: ExperimentRunTotals;
}): ExperimentRunWithItems {
  const dataset: ExperimentRunDatasetEntry[] = [];
  const evaluations: ExperimentRunEvaluation[] = [];

  let targets = null;
  try {
    const parsed = JSON.parse(runRecord.Targets);
    if (Array.isArray(parsed) && parsed.length > 0) {
      targets = parsed;
    }
  } catch {
    // Targets may be empty or invalid JSON
  }

  for (const item of items) {
    if (item.ResultType === "target") {
      let entry: Record<string, unknown> = {};
      try {
        entry = JSON.parse(item.DatasetEntry);
      } catch {
        // fallback to empty object
      }

      let predicted: Record<string, unknown> | undefined;
      if (item.Predicted) {
        try {
          predicted = JSON.parse(item.Predicted);
        } catch {
          // fallback to undefined
        }
      }

      const targetId =
        item.TargetId && item.TargetId !== "default" ? item.TargetId : null;
      dataset.push({
        index: item.RowIndex,
        targetId,
        entry,
        predicted,
        cost: item.TargetCost,
        duration: item.TargetDurationMs,
        error: item.TargetError,
        // The code the customer's copy comes from. Rows written before the
        // column existed have none, and read back on the raw string as before.
        domainError: parseDomainError(item.TargetDomainError),
        traceId: item.TraceId,
      });
    } else if (item.ResultType === "evaluator") {
      const targetId =
        item.TargetId && item.TargetId !== "default" ? item.TargetId : null;
      evaluations.push({
        evaluator: item.EvaluatorId ?? "",
        name: item.EvaluatorName,
        targetId,
        status:
          (item.EvaluationStatus as "processed" | "skipped" | "error") ||
          "error",
        index: item.RowIndex,
        score: item.Score,
        label: item.Label,
        passed: item.Passed !== null ? item.Passed === 1 : null,
        details: item.EvaluationDetails,
        cost: item.EvaluationCost,
        inputs: (() => {
          if (!item.EvaluationInputs) return null;
          try {
            return JSON.parse(item.EvaluationInputs);
          } catch {
            return null;
          }
        })(),
        duration: item.EvaluationDurationMs ?? null,
      });
    }
  }

  return {
    experimentId: runRecord.ExperimentId,
    runId: runRecord.RunId,
    projectId,
    workflowVersionId: runRecord.WorkflowVersionId,
    progress: totals ? totals.progress : null,
    total: runRecord.Total,
    targets,
    dataset,
    evaluations,
    timestamps: {
      createdAt: parseClickHouseDateTimeMs(runRecord.CreatedAt),
      updatedAt: parseClickHouseDateTimeMs(runRecord.UpdatedAt),
      finishedAt: runRecord.FinishedAt
        ? parseClickHouseDateTimeMs(runRecord.FinishedAt)
        : null,
      stoppedAt: runRecord.StoppedAt
        ? parseClickHouseDateTimeMs(runRecord.StoppedAt)
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared ES target mapper
// ---------------------------------------------------------------------------

/**
 * Maps legacy snake_case targets to the canonical camelCase shape.
 */
export function mapEsTargetsToTargets(
  targets: ESBatchEvaluationTarget[],
): ExperimentRunTarget[] {
  return targets.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    promptId: t.prompt_id,
    promptVersion: t.prompt_version,
    agentId: t.agent_id,
    evaluatorId: t.evaluator_id,
    model: t.model,
    metadata: t.metadata,
  }));
}
