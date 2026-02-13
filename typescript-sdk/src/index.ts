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
  type EvaluationStatus as ExperimentEvaluationStatus,
  type TargetType,
  type TargetMetadata,
  type TargetInfo,
  type EvaluationResult as ExperimentEvaluationResult,
  type ExperimentInitOptions,
  type LogOptions,
  type EvaluateOptions as ExperimentEvaluateOptions,
  type RunOptions,
  type RunCallback,
  type RunContext,
  ExperimentError,
  ExperimentInitError,
  ExperimentApiError,
  TargetMetadataConflictError,
  EvaluatorError,
} from "./client-sdk/services/experiments";

// Evaluators API exports
export {
  EvaluatorsApiService,
  type EvaluatorResponse,
  type EvaluatorField,
  type CreateEvaluatorBody,
  EvaluatorsApiError,
} from "./client-sdk/services/evaluators";

// Evaluations API exports (Online Evaluations / Guardrails)
export {
  EvaluationsFacade,
  type EvaluationResult,
  type EvaluateOptions,
  type EvaluationStatus,
  type EvaluationCost,
  EvaluationError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
  EvaluationsApiError,
} from "./client-sdk/services/evaluations";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};
