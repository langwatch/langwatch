/**
 * Types for the Evaluations API (Online Evaluations / Guardrails)
 *
 * These types define the structure for running evaluators and guardrails
 * in real-time against LLM inputs/outputs.
 */

/**
 * Status of an evaluation result
 */
export type EvaluationStatus = "processed" | "skipped" | "error";

/**
 * Cost information from an evaluation
 */
export type EvaluationCost = {
  currency: string;
  amount: number;
};

/**
 * Result returned from running an evaluator
 */
export type EvaluationResult = {
  /** Status of the evaluation */
  status: EvaluationStatus;
  /** Whether the evaluation passed (for guardrails) */
  passed?: boolean;
  /** Numeric score (typically 0-1) */
  score?: number;
  /** Human-readable details about the result */
  details?: string;
  /** Label/category for the result */
  label?: string;
  /** Cost of running the evaluation */
  cost?: EvaluationCost;
};

/**
 * Options for the evaluate() method
 */
export type EvaluateOptions = {
  /** Data to pass to the evaluator (input, output, contexts, etc.) */
  data: Record<string, unknown>;
  /** Human-readable name for this evaluation */
  name?: string;
  /** Evaluator-specific settings */
  settings?: Record<string, unknown>;
  /** Whether to run as a guardrail (affects error handling) */
  asGuardrail?: boolean;
};

/**
 * Internal request body for the evaluate API
 */
export type EvaluateRequest = {
  trace_id?: string | null;
  span_id?: string | null;
  name?: string | null;
  data: Record<string, unknown>;
  settings?: Record<string, unknown>;
  as_guardrail?: boolean;
};

/**
 * Response from the evaluate API
 */
export type EvaluateResponse = {
  status: EvaluationStatus;
  passed?: boolean | null;
  score?: number | null;
  details?: string | null;
  label?: string | null;
  cost?: EvaluationCost | null;
};
