/**
 * Repository pattern for batch evaluation storage.
 * This abstraction allows switching between storage backends (ES, ClickHouse)
 * without changing the business logic.
 */

import type {
  ESBatchEvaluation,
  ESBatchEvaluationTarget,
} from "~/server/experiments/types";

// ============================================================================
// Types
// ============================================================================

/**
 * Data needed to create a new batch evaluation run.
 */
export type CreateBatchEvaluationParams = {
  projectId: string;
  experimentId: string;
  runId: string;
  workflowVersionId?: string | null;
  total: number;
  targets?: ESBatchEvaluationTarget[];
};

/**
 * A single dataset entry (target execution result).
 */
export type DatasetEntry = ESBatchEvaluation["dataset"][0];

/**
 * A single evaluation result.
 */
export type EvaluationEntry = ESBatchEvaluation["evaluations"][0];

/**
 * Parameters for upserting results.
 */
export type UpsertResultsParams = {
  projectId: string;
  experimentId: string;
  runId: string;
  dataset?: DatasetEntry[];
  evaluations?: EvaluationEntry[];
  progress?: number;
};

/**
 * Parameters for marking execution complete.
 */
export type MarkCompleteParams = {
  projectId: string;
  experimentId: string;
  runId: string;
  finishedAt?: number;
  stoppedAt?: number;
};

/**
 * Full batch evaluation record.
 */
export type BatchEvaluation = ESBatchEvaluation;

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Repository interface for batch evaluation storage.
 * Implement this interface for different storage backends.
 */
export type BatchEvaluationRepository = {
  /**
   * Create a new batch evaluation run.
   * Called at the start of execution.
   */
  create: (params: CreateBatchEvaluationParams) => Promise<void>;

  /**
   * Upsert dataset entries and evaluation results.
   * Called incrementally as results arrive.
   */
  upsertResults: (params: UpsertResultsParams) => Promise<void>;

  /**
   * Mark execution as complete or stopped.
   * Called at the end of execution.
   */
  markComplete: (params: MarkCompleteParams) => Promise<void>;

  /**
   * Get a batch evaluation by run ID.
   */
  getByRunId: (params: {
    projectId: string;
    experimentId: string;
    runId: string;
  }) => Promise<BatchEvaluation | null>;

  /**
   * List batch evaluations for an experiment.
   */
  listByExperiment: (params: {
    projectId: string;
    experimentId: string;
    limit?: number;
    offset?: number;
  }) => Promise<BatchEvaluation[]>;
};
