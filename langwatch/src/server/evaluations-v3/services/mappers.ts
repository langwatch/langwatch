/**
 * Mapper functions that convert backend-specific data shapes
 * (ClickHouse PascalCase, Elasticsearch snake_case) into the
 * canonical camelCase service types.
 */

import { parse } from "date-fns";
import type {
  ESBatchEvaluation,
  ESBatchEvaluationTarget,
} from "~/server/experiments/types";
import { parseExperimentRunKey } from "~/server/event-sourcing/pipelines/experiment-run-processing/utils/compositeKey";
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
  Id: string;
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
  Id: string;
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
  TraceId: string | null;
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null; // UInt8 in ClickHouse
  EvaluationDetails: string | null;
  EvaluationCost: number | null;
  CreatedAt: string;
}

/** Per-evaluator aggregation row from ClickHouse GROUP BY query. */
export interface ClickHouseEvaluatorBreakdownRow {
  RunId: string;
  EvaluatorId: string;
  EvaluatorName: string | null;
  avgScore: number | null;
  passRate: number | null;
  hasPassedCount: number;
}

/** Per-run cost/duration summary from ClickHouse aggregate query. */
export interface ClickHouseCostSummaryRow {
  RunId: string;
  datasetCost: number | null;
  evaluationsCost: number | null;
  datasetAverageCost: number | null;
  datasetAverageDuration: number | null;
  evaluationsAverageCost: number | null;
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
}: {
  record: ClickHouseExperimentRunRow;
  workflowVersion?: ExperimentRunWorkflowVersion | null;
  evaluatorBreakdown?: ClickHouseEvaluatorBreakdownRow[];
  costSummary?: ClickHouseCostSummaryRow;
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
    evaluations,
  };

  // RunId is a composite key (experimentId:slug) — extract the slug for the public API
  const { runId: runSlug } = parseExperimentRunKey(record.RunId);

  return {
    experimentId: record.ExperimentId,
    runId: runSlug,
    workflowVersion: workflowVersion ?? null,
    timestamps: {
      createdAt: parseClickHouseDateTime(record.CreatedAt),
      updatedAt: parseClickHouseDateTime(record.UpdatedAt),
      finishedAt: record.FinishedAt
        ? parseClickHouseDateTime(record.FinishedAt)
        : null,
      stoppedAt: record.StoppedAt
        ? parseClickHouseDateTime(record.StoppedAt)
        : null,
    },
    progress: record.Progress,
    total: record.Total,
    summary,
  };
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
}: {
  runRecord: ClickHouseExperimentRunRow;
  items: ClickHouseExperimentRunItemRow[];
  projectId: string;
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

      dataset.push({
        index: item.RowIndex,
        targetId: item.TargetId || null,
        entry,
        predicted,
        cost: item.TargetCost,
        duration: item.TargetDurationMs,
        error: item.TargetError,
        traceId: item.TraceId,
      });
    } else if (item.ResultType === "evaluator") {
      evaluations.push({
        evaluator: item.EvaluatorId ?? "",
        name: item.EvaluatorName,
        targetId: item.TargetId || null,
        status: (item.EvaluationStatus as "processed" | "skipped" | "error") ||
          "error",
        index: item.RowIndex,
        score: item.Score,
        label: item.Label,
        passed: item.Passed !== null ? item.Passed === 1 : null,
        details: item.EvaluationDetails,
        cost: item.EvaluationCost,
      });
    }
  }

  // RunId is a composite key (experimentId:slug) — extract the slug for the public API
  const { runId: runSlug } = parseExperimentRunKey(runRecord.RunId);

  return {
    experimentId: runRecord.ExperimentId,
    runId: runSlug,
    projectId,
    workflowVersionId: runRecord.WorkflowVersionId,
    progress: runRecord.Progress,
    total: runRecord.Total,
    targets,
    dataset,
    evaluations,
    timestamps: {
      createdAt: parseClickHouseDateTime(runRecord.CreatedAt),
      updatedAt: parseClickHouseDateTime(runRecord.UpdatedAt),
      finishedAt: runRecord.FinishedAt
        ? parseClickHouseDateTime(runRecord.FinishedAt)
        : null,
      stoppedAt: runRecord.StoppedAt
        ? parseClickHouseDateTime(runRecord.StoppedAt)
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Elasticsearch mappers
// ---------------------------------------------------------------------------

/** Elasticsearch run aggregation bucket (from `getExperimentBatchEvaluationRuns`). */
export interface ESRunAggregationBucket {
  key: string;
  dataset_cost: { value: number | null };
  evaluations_cost: {
    cost: { value: number | null };
    average_cost: { value: number | null };
    average_duration: { value: number | null };
  };
  dataset_average_cost: { value: number | null };
  dataset_average_duration: { value: number | null };
  evaluations: {
    child: {
      buckets: Array<{
        key: string;
        name: { buckets: Array<{ key: string }> };
        processed_evaluations: {
          average_score: { value: number | null };
          has_passed: { doc_count: number };
          average_passed: { value: number | null };
        };
      }>;
    };
  };
}

/**
 * Maps an Elasticsearch `ESBatchEvaluation` source document and its
 * aggregation bucket into the canonical `ExperimentRun` type.
 *
 * @param source - The ES document _source
 * @param runAgg - The aggregation bucket for this run
 * @param workflowVersion - Optional workflow version metadata from Prisma
 * @returns The canonical ExperimentRun
 */
export function mapEsRunToExperimentRun(
  source: Pick<
    ESBatchEvaluation,
    | "experiment_id"
    | "run_id"
    | "workflow_version_id"
    | "timestamps"
    | "progress"
    | "total"
  >,
  runAgg: ESRunAggregationBucket | undefined,
  workflowVersion?: ExperimentRunWorkflowVersion | null,
): ExperimentRun {
  const evaluations: Record<string, ExperimentRunEvaluationSummary> = {};

  if (runAgg) {
    for (const bucket of runAgg.evaluations.child.buckets) {
      const summary: ExperimentRunEvaluationSummary = {
        name: bucket.name.buckets[0]?.key ?? bucket.key,
        averageScore: bucket.processed_evaluations.average_score.value,
      };
      if (bucket.processed_evaluations.has_passed.doc_count > 0) {
        summary.averagePassed =
          bucket.processed_evaluations.average_passed.value ?? undefined;
      }
      evaluations[bucket.key] = summary;
    }
  }

  const summary: ExperimentRunSummary = {
    datasetCost: runAgg?.dataset_cost.value ?? undefined,
    evaluationsCost: runAgg?.evaluations_cost.cost.value ?? undefined,
    datasetAverageCost: runAgg?.dataset_average_cost.value ?? undefined,
    datasetAverageDuration:
      runAgg?.dataset_average_duration.value ?? undefined,
    evaluationsAverageCost:
      runAgg?.evaluations_cost.average_cost.value ?? undefined,
    evaluationsAverageDuration:
      runAgg?.evaluations_cost.average_duration.value ?? undefined,
    evaluations,
  };

  return {
    experimentId: source.experiment_id,
    runId: source.run_id,
    workflowVersion: workflowVersion ?? null,
    timestamps: {
      createdAt: source.timestamps.created_at,
      updatedAt: source.timestamps.updated_at,
      finishedAt: source.timestamps.finished_at,
      stoppedAt: source.timestamps.stopped_at,
    },
    progress: source.progress,
    total: source.total,
    summary,
  };
}

/**
 * Maps a full Elasticsearch `ESBatchEvaluation` document into the
 * canonical `ExperimentRunWithItems` type.
 *
 * @param source - The full ES batch evaluation document
 * @returns The canonical ExperimentRunWithItems
 */
export function mapEsBatchEvaluationToRunWithItems(
  source: ESBatchEvaluation,
): ExperimentRunWithItems {
  const dataset: ExperimentRunDatasetEntry[] = source.dataset.map((d) => ({
    index: d.index,
    targetId: d.target_id,
    entry: d.entry,
    predicted: d.predicted,
    cost: d.cost,
    duration: d.duration,
    error: d.error,
    traceId: d.trace_id,
  }));

  const evaluations: ExperimentRunEvaluation[] = source.evaluations.map(
    (e) => ({
      evaluator: e.evaluator,
      name: e.name,
      targetId: e.target_id,
      status: e.status,
      index: e.index,
      score: e.score,
      label: e.label,
      passed: e.passed,
      details: e.details,
      cost: e.cost,
      duration: e.duration,
      inputs: e.inputs,
    }),
  );

  const targets = source.targets
    ? mapEsTargetsToTargets(source.targets)
    : undefined;

  return {
    experimentId: source.experiment_id,
    runId: source.run_id,
    projectId: source.project_id,
    workflowVersionId: source.workflow_version_id,
    progress: source.progress,
    total: source.total,
    targets: targets ?? null,
    dataset,
    evaluations,
    timestamps: {
      createdAt: source.timestamps.created_at,
      updatedAt: source.timestamps.updated_at,
      finishedAt: source.timestamps.finished_at,
      stoppedAt: source.timestamps.stopped_at,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared ES target mapper
// ---------------------------------------------------------------------------

/**
 * Maps Elasticsearch snake_case targets to the canonical camelCase shape.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parses a ClickHouse DateTime64(3) string into a Unix timestamp in milliseconds.
 * ClickHouse returns DateTime64(3) as strings like "2024-01-15 10:30:00.000".
 */
const CLICKHOUSE_DATETIME64_FORMAT = "yyyy-MM-dd HH:mm:ss.SSSX";

function parseClickHouseDateTime(value: string): number {
  const ms = parse(`${value}Z`, CLICKHOUSE_DATETIME64_FORMAT, new Date(0)).getTime();
  return isNaN(ms) ? 0 : ms;
}
