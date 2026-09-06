/**
 * Evaluations Service - Online Evaluations / Guardrails API
 *
 * This module provides the ability to run evaluators and guardrails in real-time
 * against LLM inputs/outputs, separate from batch experiments.
 */

export { EvaluationsFacade } from "./evaluations.facade";
export type {
  EvaluationResult,
  EvaluateOptions,
  EvaluationStatus,
  EvaluationCost,
} from "./types";
export {
  EvaluationError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
  EvaluationsApiError,
} from "./errors";
