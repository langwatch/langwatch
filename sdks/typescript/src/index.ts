import { ConsoleLogger, NoOpLogger } from "./logger";

export { getLangWatchTracer, getLangWatchLogger, attributes } from "./observability-sdk";

export {
  FilterableBatchSpanProcessor,
  type SpanProcessingExcludeRule,
} from "./observability-sdk/processors";
export { LangWatchExporter } from "./observability-sdk/exporters";
export { LangWatch, FetchPolicy, type GetPromptOptions } from "./client-sdk";

/**
 * Typed API failures: `code` to switch on, `meta`, and a trace id. Narrow
 * with `isLangWatchHandledError` and match `code`, not the message — an
 * unnamed failure (5xx, dead socket) still arrives as a generic error.
 */
export {
  LangWatchHandledError,
  isLangWatchHandledError,
  LangWatchApiError,
} from "./internal/api/errors";
export type {
  CliHandledError as LangWatchHandledErrorShape,
  CliHandledErrorReason as LangWatchHandledErrorReason,
} from "@langwatch/langy-contract/cards/handled-error";

// Experiments API exports
export {
  Experiment,
  ExperimentsFacade,
  type ExperimentEvaluationStatus,
  type TargetType,
  type TargetMetadata,
  type TargetInfo,
  type ExperimentEvaluationResult,
  type ComparisonMetric,
  type ComparisonOptions,
  type ComparisonStatus,
  type ComparisonVerdict,
  type ExperimentInitOptions,
  type LogOptions,
  type ExperimentEvaluateOptions,
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
  ComparisonError,
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
  type SpendSummaryStatus,
  type SpendGroupBy,
  type SpendFilterOptions,
  type SpendSummariesOptions,
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

/**
 * Provisioning teams and projects, the two things an integration creates
 * before anything else exists to write to. Both want an organization API
 * key; creating a project also mints its own service API key, once.
 */
export {
  TeamsApiService,
  TeamsApiError,
  type Team,
  type TeamPagination,
  type TeamMember,
  type ListTeamsResponse,
  type ArchivedTeam,
} from "./client-sdk/services/teams/teams-api.service";
export {
  ProjectsApiService,
  ProjectsApiError,
  type Project,
  type PaginatedProjects,
  type ProjectWithServiceKey,
  type ArchivedProject,
  type CreateProjectInput,
  type UpdateProjectInput,
} from "./client-sdk/services/projects/projects-api.service";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};

/**
 * The HTTP client every SDK request goes through, following a redirect
 * only when it upgrades http to https on the same URL, refusing every
 * other one with `LangWatchRedirectError`.
 */
export {
  langwatchFetch,
  createLangWatchFetch,
  LangWatchRedirectError,
  type LangWatchFetch,
  type CreateLangWatchFetchOptions,
} from "./internal/http/langwatchFetch";
