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

/**
 * Typed API failures.
 *
 * When the platform DECLINES a request it says why, in a structure: a `kind`
 * you can switch on, the `meta` that makes it actionable, and the trace id to
 * quote at support. Narrow with `isLangWatchDomainError` and match the `kind`
 * rather than the message — the message is written for humans and may change;
 * the kind is the contract.
 *
 * ```ts
 * try {
 *   await langwatch.prompts.get("nope");
 * } catch (error) {
 *   if (isLangWatchDomainError(error) && error.kind === "prompt_not_found") {
 *     // ...
 *   }
 *   throw error;
 * }
 * ```
 *
 * Failures the platform did NOT name — a 5xx, a dead socket, a proxy's HTML —
 * still arrive as the generic errors they always did. A domain error means the
 * platform understood you and said no; anything else means it fell over, and
 * the two must not look alike.
 */
export {
  LangWatchDomainError,
  isLangWatchDomainError,
  LangWatchApiError,
} from "./internal/api/errors";
export type {
  CliDomainError as LangWatchDomainErrorShape,
  CliDomainErrorReason as LangWatchDomainErrorReason,
} from "@langwatch/cli-cards/domain-error";

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
  type RunWithResultsOptions,
  type ExperimentRowResult,
  type ExperimentRunWithResults,
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

// Dataset API exports
export {
  DatasetsFacade,
  DatasetError,
  DatasetNotFoundError,
  DatasetApiError,
  DatasetValidationError,
  DatasetPlanLimitError,
  type Dataset,
  type DatasetEntry,
  type DatasetMetadata,
  type DatasetColumnType,
  type DatasetListItem,
  type Pagination,
  type PaginatedResponse,
  type GetDatasetOptions,
  type ListDatasetsOptions,
  type ListDatasetsApiResponse,
  type ListRecordsOptions,
  type ListRecordsApiResponse,
  type CreateDatasetOptions,
  type UpdateDatasetOptions,
  type CreateFromUploadResponse,
  type BatchCreateRecordsResponse,
  type DeleteRecordsResponse,
  type UploadResponse,
  type DatasetRecordResponse,
} from "./client-sdk/services/datasets";

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
