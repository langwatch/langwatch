/**
 * Experiments API: batch experiments over datasets with tracing, parallel
 * execution, and evaluators. SDK-defined: `experiments.init(name)` then
 * `experiment.run(dataset, fn)`. Platform: `experiments.run("slug")`.
 */

export { Experiment } from "./experiment";
export { ExperimentsFacade } from "./experiments.facade";
export { ExperimentsApiService, ExperimentsApiServiceError } from "./experiments-api.service";
export type {
  ExperimentRunStartResponse,
  ExperimentRunStartRequest,
  ExperimentRunStatusResponse,
  ExperimentV3RunStatusResponse,
  ExperimentSummary,
  ExperimentListResponse,
  ExperimentListPagination,
  ExperimentRunSummaryEntry,
  ExperimentRunsListResponse,
  ExperimentRunDatasetEntry,
  ExperimentRunEvaluation,
  ExperimentRunResultsResponse,
} from "./experiments-api.service";

export { mapRunResultsToRows } from "./mapResults";

// SDK-defined experiment types
export type {
  ExperimentEvaluationStatus,
  TargetType,
  TargetMetadata,
  TargetInfo,
  ExperimentEvaluationResult,
  BatchEntry,
  Batch,
  ComparisonMetric,
  ComparisonOptions,
  ComparisonStatus,
  ComparisonVerdict,
  ExperimentInitOptions,
  LogOptions,
  ExperimentEvaluateOptions,
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
  ComparisonError,
  EvaluatorError,
} from "./errors";

// Platform experiment types (Experiments Workbench)
export type {
  ExperimentRunSummary,
  RunExperimentOptions,
  ExperimentRunResult,
  RunWithResultsOptions,
  ExperimentRowResult,
  ExperimentRunWithResults,
} from "./platformTypes";

// Run polling
export { pollExperimentRun, DEFAULT_POLL_INTERVAL, DEFAULT_POLL_TIMEOUT } from "./run-status";
export type { PollRunStatus, PollExperimentRunResult } from "./run-status";

export {
  ExperimentsError,
  ExperimentNotFoundError,
  ExperimentTimeoutError,
  ExperimentRunFailedError,
  ExperimentsApiError,
} from "./platformErrors";
