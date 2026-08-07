/**
 * Mapper functions that convert backend-specific data shapes
 * (ClickHouse PascalCase, legacy snake_case) into the
 * canonical camelCase service types.
 */

import type { SerializedHandledError } from "@langwatch/handled-error";
import { parseClickHouseDateTimeMs } from "~/server/clickhouse/dateTime";
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

/** Row shape returned from the `experiment_runs` ClickHouse table. */
export interface ClickHouseExperimentRunRow {
  ProjectionId: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Version: string;
  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: number | null;
  AvgScoreBps: number | null;
  PassRateBps: number | null;
  Targets: string;
  CreatedAt: string;
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;
}

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
/** Shared by both run mappers below: every ClickHouse run row carries the same four timestamp columns. */
const mapRunTimestamps = (row: ClickHouseExperimentRunRow) => ({
  createdAt: parseClickHouseDateTimeMs(row.CreatedAt),
  updatedAt: parseClickHouseDateTimeMs(row.UpdatedAt),
  finishedAt: row.FinishedAt ? parseClickHouseDateTimeMs(row.FinishedAt) : null,
  stoppedAt: row.StoppedAt ? parseClickHouseDateTimeMs(row.StoppedAt) : null,
});

const buildEvaluationSummaries = (
  evaluatorBreakdown?: ClickHouseEvaluatorBreakdownRow[],
): Record<string, ExperimentRunEvaluationSummary> => {
  const evaluations: Record<string, ExperimentRunEvaluationSummary> = {};
  if (!evaluatorBreakdown) return evaluations;

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
  return evaluations;
};

const buildRunSummary = ({
  costSummary,
  evaluations,
}: {
  costSummary?: ClickHouseCostSummaryRow;
  evaluations: Record<string, ExperimentRunEvaluationSummary>;
}): ExperimentRunSummary => ({
  datasetCost: costSummary?.datasetCost ?? undefined,
  evaluationsCost: costSummary?.evaluationsCost ?? undefined,
  datasetAverageCost: costSummary?.datasetAverageCost ?? undefined,
  datasetAverageDuration: costSummary?.datasetAverageDuration ?? undefined,
  evaluationsAverageCost: costSummary?.evaluationsAverageCost ?? undefined,
  evaluationsAverageDuration:
    costSummary?.evaluationsAverageDuration ?? undefined,
  evaluations,
});

export function mapClickHouseRunToExperimentRun({
  record,
  workflowVersion,
  evaluatorBreakdown,
  costSummary,
}: {
  record: ClickHouseExperimentRunRow;
  workflowVersion?: ExperimentRunWorkflowVersion | null;
  evaluatorBreakdown?: ClickHouseEvaluatorBreakdownRow[];
  costSummary?: ClickHouseCostSummaryRow;
}): ExperimentRun {
  const evaluations = buildEvaluationSummaries(evaluatorBreakdown);
  const summary = buildRunSummary({ costSummary, evaluations });

  return {
    experimentId: record.ExperimentId,
    runId: record.RunId,
    workflowVersion: workflowVersion ?? null,
    timestamps: mapRunTimestamps(record),
    progress: record.Progress,
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
/** Targets may be empty or invalid JSON. */
const parseTargetsField = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const resolveItemTargetId = (
  item: ClickHouseExperimentRunItemRow,
): string | null =>
  item.TargetId && item.TargetId !== "default" ? item.TargetId : null;

const parseDatasetEntry = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw);
  } catch {
    // fallback to empty object
    return {};
  }
};

const parsePredicted = (
  raw: string | null,
): Record<string, unknown> | undefined => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // fallback to undefined
    return undefined;
  }
};

const parseEvaluationInputs = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const mapTargetResultItem = (
  item: ClickHouseExperimentRunItemRow,
): ExperimentRunDatasetEntry => ({
  index: item.RowIndex,
  targetId: resolveItemTargetId(item),
  entry: parseDatasetEntry(item.DatasetEntry),
  predicted: parsePredicted(item.Predicted),
  cost: item.TargetCost,
  duration: item.TargetDurationMs,
  error: item.TargetError,
  // The code the customer's copy comes from. Rows written before the
  // column existed have none, and read back on the raw string as before.
  domainError: parseDomainError(item.TargetDomainError),
  traceId: item.TraceId,
});

const mapEvaluatorResultItem = (
  item: ClickHouseExperimentRunItemRow,
): ExperimentRunEvaluation => ({
  evaluator: item.EvaluatorId ?? "",
  name: item.EvaluatorName,
  targetId: resolveItemTargetId(item),
  status:
    (item.EvaluationStatus as "processed" | "skipped" | "error") || "error",
  index: item.RowIndex,
  score: item.Score,
  label: item.Label,
  passed: item.Passed !== null ? item.Passed === 1 : null,
  details: item.EvaluationDetails,
  cost: item.EvaluationCost,
  inputs: parseEvaluationInputs(item.EvaluationInputs),
  duration: item.EvaluationDurationMs ?? null,
});

export function mapClickHouseItemsToRunWithItems({
  runRecord,
  items,
  projectId,
}: {
  runRecord: ClickHouseExperimentRunRow;
  items: ClickHouseExperimentRunItemRow[];
  projectId: string;
}): ExperimentRunWithItems {
  const dataset: ExperimentRunDatasetEntry[] = [];
  const evaluations: ExperimentRunEvaluation[] = [];

  for (const item of items) {
    if (item.ResultType === "target") {
      dataset.push(mapTargetResultItem(item));
    } else if (item.ResultType === "evaluator") {
      evaluations.push(mapEvaluatorResultItem(item));
    }
  }

  return {
    experimentId: runRecord.ExperimentId,
    runId: runRecord.RunId,
    projectId,
    workflowVersionId: runRecord.WorkflowVersionId,
    progress: runRecord.Progress,
    total: runRecord.Total,
    targets: parseTargetsField(runRecord.Targets),
    dataset,
    evaluations,
    timestamps: mapRunTimestamps(runRecord),
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
