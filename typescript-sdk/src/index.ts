import { ConsoleLogger, NoOpLogger } from "./logger";

export {
  getLangWatchTracer,
  getLangWatchLogger,
  attributes,
} from "./observability-sdk";

export {
  FilterableBatchSpanProcessor,
  type SpanProcessingExcludeRule,
} from "./observability-sdk/processors";
export { LangWatchExporter } from "./observability-sdk/exporters";
export { LangWatch, FetchPolicy, type GetPromptOptions } from "./client-sdk";

// Experiments API exports
export {
  Experiment,
  ExperimentsFacade,
  type EvaluationStatus,
  type TargetType,
  type TargetMetadata,
  type TargetInfo,
  type EvaluationResult,
  type ExperimentInitOptions,
  type LogOptions,
  type EvaluateOptions,
  type RunOptions,
  type RunCallback,
  type RunContext,
  ExperimentError,
  ExperimentInitError,
  ExperimentApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./client-sdk/services/experiments";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};
