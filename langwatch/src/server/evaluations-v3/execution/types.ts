import { z } from "zod";
import {
  type DatasetReference,
  type EvaluatorConfig,
  evaluatorConfigSchema,
  type FieldMapping,
  type TargetConfig,
  targetConfigSchema,
} from "~/evaluations-v3/types";
import type { Workflow } from "~/optimization_studio/types/dsl";
import type { SingleEvaluationResult } from "~/server/evaluations/evaluators.generated";

// ============================================================================
// Execution Request Types
// ============================================================================

/**
 * Scope of execution - what subset of the evaluation to run.
 */
export type ExecutionScope =
  | { type: "full" }
  | { type: "rows"; rowIndices: number[] }
  | { type: "target"; targetId: string }
  | { type: "cell"; targetId: string; rowIndex: number }
  | {
      type: "evaluator";
      targetId: string;
      rowIndex: number;
      evaluatorId: string;
      /** Pre-computed target output to use instead of re-running target */
      targetOutput?: unknown;
      /** Existing trace ID to reuse for evaluator execution */
      traceId?: string;
    };

/**
 * Input to start an evaluation execution.
 * The frontend sends the full state to avoid autosave timing issues.
 */
export type ExecutionRequest = {
  projectId: string;
  experimentId?: string;
  experimentSlug?: string;
  name: string;
  dataset: DatasetReference;
  targets: TargetConfig[];
  evaluators: EvaluatorConfig[];
  scope: ExecutionScope;
  /** Concurrency limit for parallel execution (default 10) */
  concurrency?: number;
};

export const executionRequestSchema = z.object({
  projectId: z.string(),
  experimentId: z.string().optional(),
  experimentSlug: z.string().optional(),
  name: z.string(),
  dataset: z.object({
    id: z.string(),
    name: z.string(),
    type: z.enum(["inline", "saved"]),
    inline: z
      .object({
        columns: z.array(
          z.object({ id: z.string(), name: z.string(), type: z.string() }),
        ),
        records: z.record(z.string(), z.array(z.string())),
      })
      .optional(),
    datasetId: z.string().optional(),
    columns: z.array(
      z.object({ id: z.string(), name: z.string(), type: z.string() }),
    ),
    savedRecords: z
      .array(z.object({ id: z.string() }).passthrough())
      .optional(),
  }),
  // Use shared schemas to avoid duplication and ensure consistency
  targets: z.array(targetConfigSchema),
  evaluators: z.array(evaluatorConfigSchema),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("full") }),
    z.object({ type: z.literal("rows"), rowIndices: z.array(z.number()) }),
    z.object({ type: z.literal("target"), targetId: z.string() }),
    z.object({
      type: z.literal("cell"),
      targetId: z.string(),
      rowIndex: z.number(),
    }),
    z.object({
      type: z.literal("evaluator"),
      targetId: z.string(),
      rowIndex: z.number(),
      evaluatorId: z.string(),
      targetOutput: z.unknown().optional(),
      traceId: z.string().optional(),
    }),
  ]),
  concurrency: z.number().min(1).max(24).optional(),
});

// ============================================================================
// SSE Event Types
// ============================================================================

/**
 * Summary returned when execution completes.
 */
export type ExecutionSummary = {
  runId: string;
  totalCells: number;
  completedCells: number;
  failedCells: number;
  duration: number;
  /** Number of CH dispatches that failed (non-zero means CH data may be incomplete) */
  chDispatchFailures?: number;
  timestamps: {
    startedAt: number;
    finishedAt?: number;
    stoppedAt?: number;
  };
};

/**
 * All SSE events emitted during evaluation execution.
 */
export type EvaluationV3Event =
  | { type: "execution_started"; runId: string; total: number }
  | { type: "cell_started"; rowIndex: number; targetId: string }
  | {
      type: "target_result";
      rowIndex: number;
      targetId: string;
      output: unknown;
      cost?: number;
      duration?: number;
      traceId?: string;
      error?: string;
    }
  | {
      type: "evaluator_result";
      rowIndex: number;
      targetId: string;
      evaluatorId: string;
      result: SingleEvaluationResult;
    }
  | { type: "progress"; completed: number; total: number }
  | {
      type: "error";
      message: string;
      rowIndex?: number;
      targetId?: string;
      evaluatorId?: string;
    }
  | { type: "stopped"; reason: "user" | "error" }
  | { type: "done"; summary: ExecutionSummary };

// ============================================================================
// Workflow Builder Types
// ============================================================================

/**
 * A "cell" is the unit of execution: one row + one target.
 * All evaluators for that target are included in the same workflow.
 */
export type ExecutionCell = {
  rowIndex: number;
  targetId: string;
  targetConfig: TargetConfig;
  evaluatorConfigs: EvaluatorConfig[];
  datasetEntry: Record<string, unknown>;
  /** If true, skip target execution and use precomputedTargetOutput instead */
  skipTarget?: boolean;
  /** Pre-computed target output when re-running only evaluator(s) */
  precomputedTargetOutput?: unknown;
  /** Existing trace ID to reuse (for evaluator reruns) */
  traceId?: string;
};

/**
 * Input for building a mini-workflow for a single cell.
 */
export type WorkflowBuilderInput = {
  projectId: string;
  cell: ExecutionCell;
  datasetColumns: Array<{ id: string; name: string; type: string }>;
};

/**
 * Output from the workflow builder.
 */
export type WorkflowBuilderOutput = {
  workflow: Workflow;
  /** Node ID for the target so we can map results back */
  targetNodeId: string;
  /** Map of evaluator IDs to their node IDs */
  evaluatorNodeIds: Record<string, string>;
};

// ============================================================================
// Execution State Types (internal orchestrator state)
// ============================================================================

export type CellExecutionStatus = "pending" | "running" | "success" | "error";

export type CellExecutionState = {
  rowIndex: number;
  targetId: string;
  status: CellExecutionStatus;
  targetOutput?: unknown;
  targetError?: string;
  targetCost?: number;
  targetDuration?: number;
  targetTraceId?: string;
  evaluatorResults: Record<string, SingleEvaluationResult>;
  startedAt?: number;
  finishedAt?: number;
};

export type ExecutionState = {
  runId: string;
  projectId: string;
  experimentId?: string;
  status: "running" | "stopped" | "completed" | "error";
  cells: Map<string, CellExecutionState>; // key: `${rowIndex}-${targetId}`
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  timestamps: {
    startedAt: number;
    finishedAt?: number;
    stoppedAt?: number;
  };
  error?: string;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique key for a cell (row + target combination).
 */
export const getCellKey = (rowIndex: number, targetId: string): string =>
  `${rowIndex}-${targetId}`;

/**
 * Parse a cell key back to its components.
 */
export const parseCellKey = (
  key: string,
): { rowIndex: number; targetId: string } => {
  const dashIndex = key.indexOf("-");
  return {
    rowIndex: parseInt(key.substring(0, dashIndex), 10),
    targetId: key.substring(dashIndex + 1),
  };
};

/**
 * Create an initial cell execution state.
 */
export const createInitialCellState = (
  rowIndex: number,
  targetId: string,
): CellExecutionState => ({
  rowIndex,
  targetId,
  status: "pending",
  evaluatorResults: {},
});
