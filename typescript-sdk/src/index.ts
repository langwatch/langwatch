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

// Evaluation API exports
export {
  Evaluation,
  EvaluationFacade,
  type EvaluationStatus,
  type TargetType,
  type TargetMetadata,
  type TargetInfo,
  type EvaluationResult,
  type EvaluationInitOptions,
  type LogOptions,
  type EvaluateOptions,
  type RunOptions,
  type RunCallback,
  type RunContext,
  EvaluationError,
  EvaluationInitError,
  EvaluationApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./client-sdk/services/evaluation";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};
