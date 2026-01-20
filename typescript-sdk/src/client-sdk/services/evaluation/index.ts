/**
 * Experiments API
 *
 * Run batch experiments over datasets with automatic tracing,
 * parallel execution, and built-in evaluator support.
 *
 * @example SDK-defined experiment
 * ```typescript
 * const langwatch = new LangWatch({ apiKey: process.env.LANGWATCH_API_KEY });
 * const evaluation = await langwatch.experiments.init('my-experiment');
 *
 * await evaluation.run(dataset, async ({ item, index, span }) => {
 *   const response = await myAgent(item.question);
 *   evaluation.log('accuracy', { index, score: 0.95 });
 * });
 * ```
 *
 * @example Platform-configured experiment (Experiments Workbench)
 * ```typescript
 * const langwatch = new LangWatch();
 * const result = await langwatch.experiments.run("my-experiment-slug");
 * result.printSummary();
 * ```
 */

export { Evaluation } from "./evaluation";
export { EvaluationFacade } from "./evaluation.facade";

// SDK-defined evaluation types
export type {
  EvaluationStatus,
  TargetType,
  TargetMetadata,
  TargetInfo,
  EvaluationResult,
  BatchEntry,
  Batch,
  EvaluationInitOptions,
  LogOptions,
  EvaluateOptions,
  RunOptions,
  RunCallback,
  RunContext,
  TargetContext,
  TargetCallback,
  TargetResult,
  TargetExecutionContext,
} from "./types";

export {
  EvaluationError,
  EvaluationInitError,
  EvaluationApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./errors";

// Platform evaluation types (Evaluations V3)
export type {
  EvaluationRunSummary,
  RunEvaluationOptions,
  EvaluationRunResult,
} from "./platformTypes";

export {
  EvaluationsError,
  EvaluationNotFoundError,
  EvaluationTimeoutError,
  EvaluationRunFailedError,
  EvaluationsApiError,
} from "./platformErrors";
