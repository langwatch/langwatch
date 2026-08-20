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

export {
  ComparisonError,
  EvaluatorError,
  ExperimentApiError,
  ExperimentError,
  ExperimentInitError,
  TargetMetadataConflictError,
} from "./errors";
export { Experiment } from "./experiment";
export { ExperimentsFacade } from "./experiments.facade";
export type {
  ExperimentListPagination,
  ExperimentListResponse,
  ExperimentRunDatasetEntry,
  ExperimentRunEvaluation,
  ExperimentRunResultsResponse,
  ExperimentRunStartRequest,
  ExperimentRunStartResponse,
  ExperimentRunStatusResponse,
  ExperimentRunSummaryEntry,
  ExperimentRunsListResponse,
  ExperimentSummary,
  ExperimentV3RunStatusResponse,
} from "./experiments-api.service";
export {
  ExperimentsApiService,
  ExperimentsApiServiceError,
} from "./experiments-api.service";
export { mapRunResultsToRows } from "./mapResults";
export {
  ExperimentNotFoundError,
  ExperimentRunFailedError,
  ExperimentsApiError,
  ExperimentsError,
  ExperimentTimeoutError,
} from "./platformErrors";

// Platform experiment types (Experiments Workbench)
export type {
  ExperimentRowResult,
  ExperimentRunResult,
  ExperimentRunSummary,
  ExperimentRunWithResults,
  RunExperimentOptions,
  RunWithResultsOptions,
} from "./platformTypes";
export type { PollExperimentRunResult, PollRunStatus } from "./run-status";
// Run polling
export {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_POLL_TIMEOUT,
  pollExperimentRun,
} from "./run-status";
// SDK-defined experiment types
export type {
  Batch,
  BatchEntry,
  ComparisonMetric,
  ComparisonOptions,
  ComparisonStatus,
  ComparisonVerdict,
  EvaluateOptions,
  EvaluationResult,
  EvaluationStatus,
  ExperimentInitOptions,
  LogOptions,
  RunCallback,
  RunContext,
  RunOptions,
  TargetCallback,
  TargetContext,
  TargetExecutionContext,
  TargetInfo,
  TargetMetadata,
  TargetResult,
  TargetType,
} from "./types";
