/**
 * Public API types for the ExperimentRunService.
 *
 * All types use camelCase naming convention. Backend-specific mappers
 * convert from PascalCase (ClickHouse) or snake_case (Elasticsearch)
 * into these canonical types.
 */

import type { ExperimentRunTarget } from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/shared";

export type { ExperimentRunTarget };

/** Per-evaluator summary within a run. */
export interface ExperimentRunEvaluationSummary {
  name: string;
  averageScore: number | null;
  averagePassed?: number;
}

/** Aggregate summary of an experiment run's costs, durations, and evaluations. */
export interface ExperimentRunSummary {
  datasetCost?: number;
  evaluationsCost?: number;
  datasetAverageCost?: number;
  datasetAverageDuration?: number;
  evaluationsAverageCost?: number;
  evaluationsAverageDuration?: number;
  evaluations: Record<string, ExperimentRunEvaluationSummary>;
}

/** Workflow version metadata attached to a run. */
export interface ExperimentRunWorkflowVersion {
  id: string;
  version: string;
  commitMessage: string;
  author: {
    name: string | null;
    image: string | null;
  } | null;
}

/** Summary-level representation of an experiment run (used in list views). */
export interface ExperimentRun {
  experimentId: string;
  runId: string;
  workflowVersion: ExperimentRunWorkflowVersion | null;
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
  progress?: number | null;
  total?: number | null;
  summary: ExperimentRunSummary;
}

/** A single dataset entry within a run. */
export interface ExperimentRunDatasetEntry {
  index: number;
  targetId?: string | null;
  entry: Record<string, unknown>;
  predicted?: Record<string, unknown>;
  cost?: number | null;
  duration?: number | null;
  error?: string | null;
  traceId?: string | null;
}

/** A single evaluation result within a run. */
export interface ExperimentRunEvaluation {
  evaluator: string;
  name?: string | null;
  targetId?: string | null;
  status: "processed" | "skipped" | "error";
  index: number;
  score?: number | null;
  label?: string | null;
  passed?: boolean | null;
  details?: string | null;
  cost?: number | null;
  duration?: number | null;
  inputs?: Record<string, unknown> | null;
}

/** Full run data with all dataset entries and evaluation results. */
export interface ExperimentRunWithItems {
  experimentId: string;
  runId: string;
  projectId: string;
  workflowVersionId?: string | null;
  progress?: number | null;
  total?: number | null;
  targets?: ExperimentRunTarget[] | null;
  dataset: ExperimentRunDatasetEntry[];
  evaluations: ExperimentRunEvaluation[];
  timestamps: {
    createdAt: number;
    updatedAt: number;
    finishedAt?: number | null;
    stoppedAt?: number | null;
  };
}

