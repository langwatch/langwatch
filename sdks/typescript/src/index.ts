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
 * When the platform DECLINES a request it says why, in a structure: a `code`
 * you can switch on, the `meta` that makes it actionable, and the trace id to
 * quote at support. Narrow with `isLangWatchHandledError` and match the `code`
 * rather than the message — the message is written for humans and may change;
 * the code is the contract.
 *
 * ```ts
 * try {
 *   await langwatch.prompts.get("nope");
 * } catch (error) {
 *   if (isLangWatchHandledError(error) && error.code === "prompt_not_found") {
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
  LangWatchHandledError,
  isLangWatchHandledError,
  LangWatchApiError,
} from "./internal/api/errors";
export type {
  CliHandledError as LangWatchHandledErrorShape,
  CliHandledErrorReason as LangWatchHandledErrorReason,
} from "@langwatch/langy/cards/handled-error";

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

/**
 * The per-call options every mutating call on the gateway and webhook
 * surfaces accepts, including the idempotency key that makes a create safe to
 * retry after a timeout.
 */
export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type MutationOptions,
  type IdempotentCreateOptions,
} from "./client-sdk/services/_shared/mutation-options";

// AI Gateway management API exports (virtual keys + budgets)
export {
  VirtualKeysApiService,
  VirtualKeysApiError,
  type VirtualKey,
  type VirtualKeyScope,
  type VirtualKeyScopeType,
  type VirtualKeyRoutingMode,
  type VirtualKeyBudgetInput,
  type VirtualKeyWithSecret,
  type VirtualKeyPage,
  type VirtualKeySpendSummary,
  type CreateVirtualKeyInput,
  type UpdateVirtualKeyInput,
} from "./client-sdk/services/virtual-keys/virtual-keys-api.service";
export {
  WebhooksApiService,
  WebhooksApiError,
  type WebhookEndpointSummary,
  type WebhookEndpointWithSecret,
  type WebhookDeliveryRecord,
  type WebhookDeliveryPage,
  type WebhookTestResult,
  type WebhookEndpointHealth,
  type WebhookEventType,
  type EmittedEvent,
  type EmittedEventsPage,
  type CreateWebhookEndpointInput,
  type UpdateWebhookEndpointInput,
} from "./client-sdk/services/webhooks/webhooks-api.service";
/**
 * Receiving webhooks, which needs no API client at all: a receiver holds a
 * signing secret and the raw request, and has to decide whether to trust it.
 */
export {
  verifyWebhookSignature,
  WebhookSignatureVerificationError,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  type WebhookSignatureFailureCode,
  type VerifyWebhookSignatureOptions,
} from "./client-sdk/services/webhooks/verify-signature";
export {
  SpendEventsApiService,
  SpendEventsApiError,
  type SpendEvent,
  type SpendEventsPage,
  type SpendSummaryRow,
  type SpendSummariesPage,
  type SpendEventStatus,
  type SpendReplayResult,
  type EndUserSpend,
  type EndUserCap,
} from "./client-sdk/services/spend-events/spend-events-api.service";
export {
  GatewayBudgetsApiService,
  GatewayBudgetsApiError,
  type GatewayBudget,
  type GatewayBudgetPage,
  type BudgetScopeKind,
  type BudgetWindow,
  type BudgetOnBreach,
  type CreateGatewayBudgetScope,
  type CreateGatewayBudgetInput,
  type UpdateGatewayBudgetInput,
} from "./client-sdk/services/gateway-budgets/gateway-budgets-api.service";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};
