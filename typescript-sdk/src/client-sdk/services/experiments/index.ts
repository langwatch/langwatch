/**
 * Experiments API
 *
 * Run batch experiments over datasets with automatic tracing,
 * parallel execution, and built-in evaluator support.
 *
 * @example SDK-defined experiment
 * ```typescript
 * const langwatch = new LangWatch({ apiKey: process.env.LANGWATCH_API_KEY });
 * const experiment = await langwatch.experiments.init('my-experiment');
 *
 * await experiment.run(dataset, async ({ item, index, span }) => {
 *   const response = await myAgent(item.question);
 *   experiment.log('accuracy', { index, score: 0.95 });
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

export { Experiment } from "./experiment";
export { ExperimentsFacade } from "./experiments.facade";

// SDK-defined experiment types
export type {
  EvaluationStatus,
  TargetType,
  TargetMetadata,
  TargetInfo,
  EvaluationResult,
  BatchEntry,
  Batch,
  ExperimentInitOptions,
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
  ExperimentError,
  ExperimentInitError,
  ExperimentApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./errors";

// Platform experiment types (Experiments Workbench)
export type {
  ExperimentRunSummary,
  RunExperimentOptions,
  ExperimentRunResult,
} from "./platformTypes";

export {
  ExperimentsError,
  ExperimentNotFoundError,
  ExperimentTimeoutError,
  ExperimentRunFailedError,
  ExperimentsApiError,
} from "./platformErrors";
