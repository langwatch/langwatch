/**
 * Evaluations Service - Online Evaluations / Guardrails API
 *
 * This module provides the ability to run evaluators and guardrails in real-time
 * against LLM inputs/outputs, separate from batch experiments.
 */

export {
  EvaluationError,
  EvaluationsApiError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
} from "./errors";
export { EvaluationsFacade } from "./evaluations.facade";
export type {
  EvaluateOptions,
  EvaluationCost,
  EvaluationResult,
  EvaluationStatus,
} from "./types";
