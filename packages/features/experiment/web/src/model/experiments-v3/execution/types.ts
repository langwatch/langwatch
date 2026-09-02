import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";
import {
  type DatasetReference,
  type EvaluatorConfig,
  evaluatorConfigSchema,
  type TargetConfig,
  targetConfigSchema,
} from "../types";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";

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
  | {
      type: "target-rows";
      targetIds: string[];
      /** Omitted means every row of the dataset. */
      rowIndices?: number[];
    }
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
    }
  | {
      type: "evaluator-all-rows";
      targetId: string;
      evaluatorId: string;
      /** Pre-computed target outputs by row index (only rows with outputs) */
      precomputedTargetOutputs: Record<number, unknown>;
      /** Existing trace IDs by row index for reuse */
      traceIds: Record<number, string | undefined>;
    };

/**
 * One board cell a run carries rather than produces.
 *
 * A run holds a snapshot of the whole board, so opening it shows what the
 * person was looking at instead of the single column they clicked. The cells
 * outside the execution scope are copied in from the board at run start; the
 * cells inside it fill in as they execute.
 *
 * The cell keeps what it cost and how long it took when it was produced,
 * because the results page reads those to draw the column's header metrics.
 * The run's own totals leave them out, which is what the recorded item's
 * `carriedOver` flag is for.
 */
export type CarriedOverCell = {
  rowIndex: number;
  targetId: string;
  output?: unknown;
  cost?: number;
  duration?: number;
  traceId?: string;
  /** The engine's raw string for a cell that failed. */
  error?: string;
  domainError?: SerializedHandledError;
  /** Verdicts on this cell, by evaluator id. */
  evaluatorResults: Array<{ evaluatorId: string; result: unknown }>;
};

export const carriedOverCellSchema = z.object({
  rowIndex: z.number(),
  targetId: z.string(),
  output: z.unknown().optional(),
  cost: z.number().optional(),
  duration: z.number().optional(),
  traceId: z.string().optional(),
  error: z.string().optional(),
  domainError: z
    .custom<SerializedHandledError>(
      (value) => typeof value === "object" && value !== null,
    )
    .optional(),
  evaluatorResults: z.array(
    z.object({ evaluatorId: z.string(), result: z.unknown() }),
  ),
});

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
  /**
   * Pre-existing target outputs the client already has for targets NOT
   * being re-run this dispatch. Used by Phase 2 pairwise so it can read
   * variantA / variantB outputs from a prior run without forcing them to
   * re-execute. Keyed by `${rowIndex}:${targetId}`.
   */
  seedTargetOutputs?: Record<
    string,
    { output: unknown; cost?: number; duration?: number }
  >;
  /**
   * Board cells the run carries rather than produces, so the run holds the
   * whole board and not only the column that was clicked. Sent by the page,
   * because the page's board can be ahead of the last autosave.
   */
  carriedOverCells?: CarriedOverCell[];
  /** Inline row data to evaluate instead of a saved or attached dataset. */
  data?: Array<Record<string, unknown>>;
  /** Saved platform dataset id to load and evaluate. Mutually exclusive with data. */
  dataset_id?: string;
  /** Constant inputs applied to every row, overriding entry fields. */
  parameters?: Record<string, string | number | boolean>;
};

export const executionRequestSchema = z
  .object({
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
      columns: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
      savedRecords: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    }),
    // Use shared schemas to avoid duplication and ensure consistency
    targets: z.array(targetConfigSchema),
    evaluators: z.array(evaluatorConfigSchema),
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("full") }),
      z.object({ type: z.literal("rows"), rowIndices: z.array(z.number()) }),
      z.object({ type: z.literal("target"), targetId: z.string() }),
      // Neither filter may be empty. Omitting `rowIndices` is how a caller
      // asks for every row, so an empty list can only mean no rows, and an
      // empty `targetIds` says the same about the columns. Either one reaches
      // the engine as a run that reports success over zero cells.
      z.object({
        type: z.literal("target-rows"),
        targetIds: z.array(z.string()).min(1),
        rowIndices: z.array(z.number()).min(1).optional(),
      }),
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
      z.object({
        type: z.literal("evaluator-all-rows"),
        targetId: z.string(),
        evaluatorId: z.string(),
        precomputedTargetOutputs: z.record(z.coerce.number(), z.unknown()),
        traceIds: z.record(z.coerce.number(), z.string().optional()),
      }),
    ]),
    concurrency: z.number().min(1).max(24).optional(),
    /** Inline row data to evaluate instead of a saved or attached dataset (row-first). */
    data: z.array(z.record(z.string(), z.unknown())).optional(),
    /** Saved platform dataset id to load and evaluate. Mutually exclusive with data. */
    dataset_id: z.string().optional(),
    /** Constant inputs applied to every row, overriding entry fields. */
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    // Row subsetting on /execute is expressed through `scope` ({ type: "rows" });
    // a separate row_indices here would be redundant and is intentionally absent.
    // The CI run path (/:slug/run) carries its own row_indices in runInputsBodySchema.
    seedTargetOutputs: z
      .record(
        z.string(),
        z.object({
          output: z.unknown(),
          cost: z.number().optional(),
          duration: z.number().optional(),
        }),
      )
      .optional(),
    carriedOverCells: z.array(carriedOverCellSchema).optional(),
  })
  .refine((req) => !(req.data && req.dataset_id), {
    message: "Pass either inline data or a dataset_id, not both",
    path: ["data"],
  });

/**
 * Optional run inputs accepted as a JSON body by the run API and the workflow
 * evaluate endpoint: inline data, a saved dataset id, constant parameters that
 * override every row, and a row-index subset. data and dataset_id are mutually
 * exclusive.
 */
export const runInputsBodySchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).optional(),
    dataset_id: z.string().optional(),
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    row_indices: z.array(z.number().int().nonnegative()).optional(),
  })
  .refine((b) => !(b.data && b.dataset_id), {
    message: "Pass either inline data or a dataset_id, not both",
    path: ["data"],
  });
export type RunInputsBody = z.infer<typeof runInputsBodySchema>;

/**
 * True when a run evaluates the experiment's own saved dataset, untouched.
 *
 * Only such a run may write its cells back into the workbench state. Rows sent
 * in the request, a different saved dataset, or constant parameters all make
 * the outputs disagree with the rows the workbench shows, so those runs leave
 * the saved cells alone. A row subset is not an override: it fills the rows it
 * ran and leaves the rest as they were.
 */
export const runsSavedDataset = (runInputs?: RunInputsBody): boolean => {
  if (!runInputs) return true;
  if (runInputs.data !== undefined) return false;
  if (runInputs.dataset_id !== undefined) return false;
  return Object.keys(runInputs.parameters ?? {}).length === 0;
};

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

export type EvaluationV3EvaluatorResult = SingleEvaluationResult & {
  domainError?: SerializedHandledError;
};

/**
 * The `message` an error frame carries when the failure has no code.
 *
 * A marker, deliberately not a sentence. An unhandled failure has nothing safe
 * to say — its own message can carry a hostname, a Prisma string or a Go net
 * error — and the generic line that replaced it was still SERVER-authored copy,
 * which then got persisted and painted into a cell on read-back. The words for
 * an unnamed failure belong in the client's presentation registry with every
 * other error's words (ADR-045); this only says "there were none".
 *
 * The failure's own words go to the log line, beside the trace id.
 */
export const UNNAMED_FAILURE = "lw.unnamed_failure";

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
      /**
       * Raw engineer-facing message — a legacy fallback the client renders
       * only when there is no `domainError`. Since the node-error code now
       * travels, this is for older engines and un-coded failures.
       */
      error?: string;
      /**
       * The coded failure, mirroring the evaluator side
       * (`EvaluationV3EvaluatorResult.domainError`). Built from the engine's
       * `NodeError.Type`; the client renders customer copy from the
       * presentation registry rather than the raw `error` string.
       */
      domainError?: SerializedHandledError;
    }
  | {
      type: "evaluator_result";
      rowIndex: number;
      targetId: string;
      evaluatorId: string;
      // Display name for evaluators that carry one without a DB record (workflow
      // evaluator nodes). DB-backed evaluators resolve their name at storage time.
      evaluatorName?: string;
      result: EvaluationV3EvaluatorResult;
      duration?: number;
      /**
       * The request payload sent to the evaluator (e.g. a Comparison
       * evaluator's ordered `candidates` list). Persisted so downstream
       * aggregation can recover which variants were actually compared on
       * this row, independent of which one won.
       */
      inputs?: Record<string, unknown>;
    }
  | { type: "progress"; completed: number; total: number }
  | {
      type: "error";
      /**
       * Wire message. For a coded failure this is the code itself (#5984); for
       * an unhandled one it is {@link UNNAMED_FAILURE} — a marker, not copy.
       *
       * Never a thrown error's own `message`: that is server prose naming
       * internal services, and it is not the app's UI copy either. The words a
       * customer reads are written in the client's presentation registry,
       * keyed by code.
       */
      message: string;
      /**
       * The coded failure, when we knew what went wrong. The client presents
       * from this via the registry, exactly as it does for `target_result`.
       */
      domainError?: SerializedHandledError;
      /**
       * The trace to hand support. An unhandled failure deliberately tells the
       * client nothing about what went wrong, which leaves the id as the only
       * thing that ties "it broke" to the log line — the same reasoning as
       * `data.traceId` on the tRPC boundary. A handled failure also carries it
       * inside `domainError`; this is the field a caller can read either way.
       */
      traceId?: string;
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
  /**
   * Comparison candidates baked into the cell after Phase 1 target execution,
   * in the order the config lists its variants. Set ONLY for synthetic
   * comparison cells; `targetId` on those cells points at a real TargetConfig
   * so the workflow builder has something to lean on, but the target step
   * itself is skipped via `skipTarget`.
   *
   * Two candidates is not a special case — a pairwise comparison is simply a
   * `candidates` array of length 2.
   */
  comparison?: {
    candidates: Array<{
      id: string;
      output: unknown;
      cost?: number;
      duration?: number;
    }>;
  };
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
  workflow: StudioWorkflow;
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
export const parseCellKey = (key: string): { rowIndex: number; targetId: string } => {
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
