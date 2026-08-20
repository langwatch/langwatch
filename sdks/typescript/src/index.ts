import { ConsoleLogger, NoOpLogger } from "./logger";

export type {
  CliHandledError as LangWatchHandledErrorShape,
  CliHandledErrorReason as LangWatchHandledErrorReason,
} from "@langwatch/langy/cards/handled-error";
export { FetchPolicy, type GetPromptOptions, LangWatch } from "./client-sdk";
/**
 * The per-call options every mutating call on the gateway and webhook
 * surfaces accepts, including the idempotency key that makes a create safe to
 * retry after a timeout.
 */
export {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type IdempotentCreateOptions,
  type MutationOptions,
} from "./client-sdk/services/_shared/mutation-options";
// Dataset API exports
export {
  type BatchCreateRecordsResponse,
  type CreateDatasetOptions,
  type CreateFromUploadResponse,
  type Dataset,
  DatasetApiError,
  type DatasetColumnType,
  type DatasetEntry,
  DatasetError,
  type DatasetListItem,
  type DatasetMetadata,
  DatasetNotFoundError,
  DatasetPlanLimitError,
  type DatasetRecordResponse,
  DatasetsFacade,
  DatasetValidationError,
  type DeleteRecordsResponse,
  type GetDatasetOptions,
  type ListDatasetsApiResponse,
  type ListDatasetsOptions,
  type ListRecordsApiResponse,
  type ListRecordsOptions,
  type PaginatedResponse,
  type Pagination,
  type UpdateDatasetOptions,
  type UploadResponse,
} from "./client-sdk/services/datasets";
// Evaluations API exports (Online Evaluations / Guardrails)
export {
  type EvaluateOptions,
  type EvaluationCost,
  EvaluationError,
  type EvaluationResult,
  type EvaluationStatus,
  EvaluationsApiError,
  EvaluationsFacade,
  EvaluatorCallError,
  EvaluatorNotFoundError,
} from "./client-sdk/services/evaluations";
// Evaluators API exports
export {
  type CreateEvaluatorBody,
  type EvaluatorField,
  type EvaluatorResponse,
  EvaluatorsApiError,
  EvaluatorsApiService,
} from "./client-sdk/services/evaluators";

// Experiments API exports
export {
  ComparisonError,
  type ComparisonMetric,
  type ComparisonOptions,
  type ComparisonStatus,
  type ComparisonVerdict,
  type EvaluateOptions as ExperimentEvaluateOptions,
  type EvaluationResult as ExperimentEvaluationResult,
  type EvaluationStatus as ExperimentEvaluationStatus,
  EvaluatorError,
  Experiment,
  ExperimentApiError,
  ExperimentError,
  ExperimentInitError,
  type ExperimentInitOptions,
  type ExperimentRowResult,
  type ExperimentRunWithResults,
  ExperimentsFacade,
  type LogOptions,
  type RunCallback,
  type RunContext,
  type RunOptions,
  type RunWithResultsOptions,
  type TargetInfo,
  type TargetMetadata,
  TargetMetadataConflictError,
  type TargetType,
} from "./client-sdk/services/experiments";
export {
  type BudgetOnBreach,
  type BudgetScopeKind,
  type BudgetWindow,
  type CreateGatewayBudgetInput,
  type CreateGatewayBudgetScope,
  type GatewayBudget,
  type GatewayBudgetPage,
  GatewayBudgetsApiError,
  GatewayBudgetsApiService,
  type UpdateGatewayBudgetInput,
} from "./client-sdk/services/gateway-budgets/gateway-budgets-api.service";
export {
  type ArchivedProject,
  type CreateProjectInput,
  type PaginatedProjects,
  type Project,
  ProjectsApiError,
  ProjectsApiService,
  type ProjectWithServiceKey,
  type UpdateProjectInput,
} from "./client-sdk/services/projects/projects-api.service";
export {
  type EndUserCap,
  type EndUserSpend,
  type SpendEvent,
  type SpendEventStatus,
  SpendEventsApiError,
  SpendEventsApiService,
  type SpendEventsPage,
  type SpendFilterOptions,
  type SpendGroupBy,
  type SpendReplayResult,
  type SpendSummariesOptions,
  type SpendSummariesPage,
  type SpendSummaryRow,
  type SpendSummaryStatus,
} from "./client-sdk/services/spend-events/spend-events-api.service";
/**
 * Provisioning teams and projects, the two things an integration has to
 * create before anything else exists to write to. Both families want an
 * organization API key; creating a project also mints that project's own
 * service API key, served once in the create response.
 */
export {
  type ArchivedTeam,
  type ListTeamsResponse,
  type Team,
  type TeamMember,
  type TeamPagination,
  TeamsApiError,
  TeamsApiService,
} from "./client-sdk/services/teams/teams-api.service";

// AI Gateway management API exports (virtual keys + budgets)
export {
  type CreateVirtualKeyInput,
  type UpdateVirtualKeyInput,
  type VirtualKey,
  type VirtualKeyBudgetInput,
  type VirtualKeyPage,
  type VirtualKeyRoutingMode,
  type VirtualKeyScope,
  type VirtualKeyScopeType,
  type VirtualKeySpendSummary,
  VirtualKeysApiError,
  VirtualKeysApiService,
  type VirtualKeyWithSecret,
} from "./client-sdk/services/virtual-keys/virtual-keys-api.service";
/**
 * Receiving webhooks, which needs no API client at all: a receiver holds a
 * signing secret and the raw request, and has to decide whether to trust it.
 */
export {
  type VerifyWebhookSignatureOptions,
  verifyWebhookSignature,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookSignatureFailureCode,
  WebhookSignatureVerificationError,
} from "./client-sdk/services/webhooks/verify-signature";
export {
  type CreateWebhookEndpointInput,
  type EmittedEvent,
  type EmittedEventsPage,
  type UpdateWebhookEndpointInput,
  type WebhookDeliveryPage,
  type WebhookDeliveryRecord,
  type WebhookEndpointHealth,
  type WebhookEndpointSummary,
  type WebhookEndpointWithSecret,
  type WebhookEventType,
  WebhooksApiError,
  WebhooksApiService,
  type WebhookTestResult,
} from "./client-sdk/services/webhooks/webhooks-api.service";
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
  isLangWatchHandledError,
  LangWatchApiError,
  LangWatchHandledError,
} from "./internal/api/errors";
export {
  attributes,
  getLangWatchLogger,
  getLangWatchTracer,
} from "./observability-sdk";
export { LangWatchExporter } from "./observability-sdk/exporters";
export {
  FilterableBatchSpanProcessor,
  type SpanProcessingExcludeRule,
} from "./observability-sdk/processors";

export const logger = {
  ConsoleLogger,
  NoOpLogger,
};
