/**
 * Types for the Evaluation API
 *
 * These types define the structure for batch evaluations, including
 * logging metrics, running evaluators, and managing targets.
 */

import { z } from "zod";
import type { LangWatchSpan } from "@/observability-sdk/span/types";

// ============================================================================
// Core Types
// ============================================================================

/**
 * Status of an evaluation result
 */
export type EvaluationStatus = "processed" | "error" | "skipped";

/**
 * Target types for batch evaluations
 */
export type TargetType = "prompt" | "agent" | "custom";

/**
 * Metadata for targets - used for comparison charts
 */
export type TargetMetadata = Record<string, string | number | boolean>;

// ============================================================================
// Zod Schemas
// ============================================================================

export const evaluationStatusSchema = z.enum(["processed", "error", "skipped"]);

export const targetTypeSchema = z.enum(["prompt", "agent", "custom"]);

export const targetMetadataSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

export const targetInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: targetTypeSchema.default("custom"),
  metadata: targetMetadataSchema.nullable().optional(),
});

export const evaluationResultSchema = z.object({
  name: z.string(),
  evaluator: z.string(),
  trace_id: z.string(),
  status: evaluationStatusSchema,
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  details: z.string().nullable().optional(),
  index: z.number().nullable().optional(),
  label: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error_type: z.string().nullable().optional(),
  traceback: z.array(z.string()).nullable().optional(),
  target_id: z.string().nullable().optional(),
});

export const batchEntrySchema = z.object({
  index: z.number(),
  entry: z.unknown(),
  duration: z.number(),
  error: z.string().nullable().optional(),
  trace_id: z.string().nullable(),  // null when no tracer configured (no-op)
  target_id: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  predicted: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Information about a registered target
 */
export type TargetInfo = z.infer<typeof targetInfoSchema>;

/**
 * Result of an evaluation
 */
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

/**
 * Entry in the batch dataset
 */
export type BatchEntry = z.infer<typeof batchEntrySchema>;

/**
 * Accumulated batch to send to the API
 */
export type Batch = {
  dataset: BatchEntry[];
  evaluations: EvaluationResult[];
  targets: TargetInfo[];
};

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Response from /api/experiment/init
 */
export type ExperimentInitResponse = {
  path: string;
  slug: string;
  id: string;
};

/**
 * Request body for /api/evaluations/batch/log_results
 */
export type LogResultsRequest = {
  experiment_slug: string;
  name: string;
  run_id: string;
  dataset: Array<{
    index: number;
    entry: unknown;
    duration: number;
    error?: string | null;
    trace_id: string | null;  // null when no tracer configured (no-op)
    target_id?: string | null;
    cost?: number | null;
    predicted?: Record<string, unknown> | null;
  }>;
  evaluations: Array<{
    name: string;
    evaluator: string;
    trace_id: string | null;  // null when no tracer configured (no-op)
    status: EvaluationStatus;
    inputs?: Record<string, unknown> | null;
    score?: number | null;
    passed?: boolean | null;
    details?: string | null;
    index?: number | null;
    label?: string | null;
    cost?: number | null;
    duration?: number | null;
    target_id?: string | null;
  }>;
  targets?: TargetInfo[];
  progress?: number;
  total?: number;
  timestamps: {
    created_at: number;
    finished_at?: number | null;
    stopped_at?: number | null;
  };
};

/**
 * Request body for /api/evaluations/:slug/evaluate
 */
export type RunEvaluatorRequest = {
  trace_id?: string | null;
  span_id?: string | null;
  name?: string | null;
  data: Record<string, unknown>;
  settings?: Record<string, unknown>;
  as_guardrail?: boolean;
};

/**
 * Response from /api/evaluations/:slug/evaluate
 */
export type RunEvaluatorResponse = {
  status: EvaluationStatus;
  passed?: boolean | null;
  score?: number | null;
  details?: string | null;
  label?: string | null;
  cost?: { currency: string; amount: number } | null;
};

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Options for initializing an evaluation
 */
export type EvaluationInitOptions = {
  /** Custom run ID (auto-generated if not provided) */
  runId?: string;
  /** Number of parallel threads for submit() */
  threads?: number;
};

/**
 * Options for the log() method
 */
export type LogOptions = {
  /**
   * Row index in the dataset.
   * Optional when called inside withTarget() - will be auto-inferred from context.
   */
  index?: number;
  /** Additional data/inputs for the evaluation */
  data?: Record<string, unknown>;
  /** Numeric score (typically 0-1) */
  score?: number;
  /** Whether the evaluation passed */
  passed?: boolean;
  /** Label/category for the result */
  label?: string;
  /** Human-readable description of the result */
  details?: string;
  /** Status of the evaluation */
  status?: EvaluationStatus;
  /** Duration in milliseconds */
  duration?: number;
  /** Cost amount in USD */
  cost?: number;
  /** Error if one occurred */
  error?: Error;
  /**
   * Target name for multi-target comparisons.
   * Optional when called inside withTarget() - will be auto-inferred from context.
   */
  target?: string;
  /** Metadata for the target (only used on first call per target) */
  metadata?: TargetMetadata;
};

/**
 * Options for the evaluate() method (built-in evaluators)
 */
export type EvaluateOptions = {
  /**
   * Row index in the dataset.
   * Optional when called inside withTarget() - will be auto-inferred from context.
   */
  index?: number;
  /** Data to pass to the evaluator */
  data: Record<string, unknown>;
  /** Evaluator settings */
  settings?: Record<string, unknown>;
  /** Human-readable name for the evaluation */
  name?: string;
  /** Whether to run as a guardrail */
  asGuardrail?: boolean;
  /**
   * Target name for multi-target comparisons.
   * Optional when called inside withTarget() - will be auto-inferred from context.
   */
  target?: string;
  /** Metadata for the target */
  metadata?: TargetMetadata;
};

/**
 * Context passed to the run() callback
 */
export type RunContext<T> = {
  /** Current index in the dataset */
  index: number;
  /** The dataset item */
  item: T;
  /** The span for this iteration (for custom instrumentation) */
  span: LangWatchSpan;
};

/**
 * Options for the run() method
 */
export type RunOptions = {
  /** Number of concurrent executions (default: 4) */
  concurrency?: number;
};

/**
 * Callback function for run()
 */
export type RunCallback<T> = (context: RunContext<T>) => Promise<void> | void;

/**
 * Internal state for tracking loop iterations
 */
export type IterationInfo = {
  index: number;
  item: unknown;
  startTime: number;
  traceId: string;
  error?: Error;
};

// ============================================================================
// withTarget() Types
// ============================================================================

/**
 * Context passed to the withTarget() callback
 */
export type TargetContext = {
  /** The LangWatch span for this target execution */
  span: import("@/observability-sdk/span/types").LangWatchSpan;
  /** The trace ID for this target execution */
  traceId: string;
  /** The span ID for this target execution */
  spanId: string;
};

/**
 * Callback function for withTarget()
 */
export type TargetCallback<R> = (context: TargetContext) => Promise<R> | R;

/**
 * Result from withTarget() including captured metrics
 */
export type TargetResult<R> = {
  /** The return value from the callback */
  result: R;
  /** Duration in milliseconds (automatically captured) */
  duration: number;
  /** Cost in USD (captured from span if available) */
  cost?: number;
  /** The trace ID for this execution */
  traceId: string;
  /** The span ID for this execution */
  spanId: string;
};

/**
 * Internal context stored in AsyncLocalStorage for target inference
 */
export type TargetExecutionContext = {
  /** The target name (id) */
  targetId: string;
  /** The trace ID for the current span */
  traceId: string;
  /** The span ID for the current span */
  spanId: string;
  /** The current dataset index */
  index: number;
};
