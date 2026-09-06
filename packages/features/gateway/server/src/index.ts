export { GatewayService } from "./services/gateway.service.ts";
export { PrismaGatewayAdapter, type GatewayPersistence } from "./adapters/prisma.gateway.adapter.ts";
export { GatewaySpendEventsService } from "./services/gateway-spend-events.service.ts";
export { GatewayEndUserCapsAdapter } from "./adapters/gateway-end-user-caps.adapter.ts";
export { GatewayEndUserCapsService } from "./services/gateway-end-user-caps.service.ts";
export * from "./services/gateway-usage.service.ts";
export { GatewayBudgetSpendPort } from "./ports/gateway-budget-spend.port.ts";
export * from "./ports/gateway-budget-spend.port.ts";
export * from "./ports/gateway-change-events.port.ts";
export * from "./ports/gateway-audit.port.ts";
export * from "./ports/gateway-virtual-key.port.ts";
export * from "./ports/gateway-clickhouse.port.ts";
export * from "./ports/gateway-settlement-policy.port.ts";
export * from "./ports/gateway-spend-events.port.ts";
export * from "./ports/gateway-virtual-key-spend.port.ts";
export * from "./adapters/fixed-gateway-settlement.adapter.ts";
export * from "./adapters/gateway-virtual-key-spend.adapter.ts";
export * from "./adapters/gateway-budget-ledger.adapter.ts";
export * from "./intents/gateway-spend.intent.ts";
export * from "./adapters/gateway-spend-events-clickhouse.adapter.ts";
export * from "./adapters/gateway-spend-cursor.adapter.ts";
export * from "./adapters/gateway-budget-dto.adapter.ts";
export * from "./adapters/gateway-virtual-key-dto.adapter.ts";
export {
  GatewayBudgetCycleAnchorInvalidError,
  GatewayBudgetNotFoundError,
  GatewayBudgetScopeUnreachableError,
  GatewayExternalIdConflictError,
  GatewayGroupBudgetUnsupportedError,
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GatewaySpendGroupByUnstableError,
  GatewaySpendUnavailableError,
  GatewayTraceProjectAmbiguousError,
  GatewayTraceProjectRequiredError,
  GatewayTraceProjectUnknownError,
  GuardrailAttachForbiddenError,
  translateExternalIdConflict,
  VirtualKeyExpiryInPastError,
  VirtualKeyNotFoundError,
} from "@langwatch/gateway-contract";
export * from "./adapters/gateway-spend-filters.adapter.ts";
export * from "./adapters/gateway-spend-grouping.adapter.ts";
export * from "./processes/gateway-spend-commands.process.ts";
export * from "./processes/gateway-spend-settlement.process.ts";
export * from "./intents/gateway-spend-settlement.intent.ts";
export * from "./ports/gateway-open-admissions.port.ts";
export * from "./adapters/clickhouse.gateway-open-admissions.adapter.ts";
export * from "./adapters/eventing.gateway-spend.adapter.ts";
export { GatewaySpendProducerAdapter } from "./adapters/gateway-spend-producer.adapter.ts";
export {
  PostgresGatewayBudgetResolutionAdapter,
  type GatewayBudgetResolutionDatabase,
} from "./adapters/postgres.gateway-budget-resolution.adapter.ts";
export type { GatewaySpendState } from "./projections/gateway-spend.projection.ts";
export * from "./adapters/gateway-wire-pagination.adapter.ts";
export * from "./adapters/virtual-key-crypto.adapter.ts";
export type * from "./services/gateway.service.ts";
export type * from "./ports/gateway-budget-spend.port.ts";

/**
 * The feature's application: the one thing every door is given, holding every
 * service and port the seven transports reach and owning the virtual-key write
 * pre-flight both doors used to run for themselves.
 */
export {
  GatewayApp,
  type GatewayActor,
  type GatewayAppDependencies,
  type GatewayApplicableBudgetTarget,
  type GatewayVirtualKeyBudgetInput,
  type GatewayVirtualKeyOperations,
} from "./app/gateway.app.ts";

/**
 * The app-process tRPC transports this feature owns. The process supplies its
 * root, authenticated procedure and policy chain; the procedure names, input
 * schemas, access declarations and delegation are the feature's.
 */
export {
  GatewayBudgetTrpcApi,
  type GatewayBudgetTrpcContext,
} from "./transport/api-trpc/gateway-budget.api.ts";
export {
  GatewayCacheRuleTrpcApi,
  type GatewayCacheRuleTrpcContext,
} from "./transport/api-trpc/gateway-cache-rule.api.ts";
export {
  GatewayGuardrailTrpcApi,
  type GatewayGuardrailTrpcContext,
} from "./transport/api-trpc/gateway-guardrail.api.ts";
export {
  GatewaySpendEventTrpcApi,
  type GatewaySpendEventTrpcContext,
} from "./transport/api-trpc/gateway-spend-event.api.ts";
export {
  GatewayUsageTrpcApi,
  type GatewayUsageTrpcContext,
} from "./transport/api-trpc/gateway-usage.api.ts";
export {
  VirtualKeyTrpcApi,
  type VirtualKeyTrpcContext,
} from "./transport/api-trpc/virtual-key.api.ts";

/** The public REST family this feature owns; routes and access declarations mirror tRPC's. */
export { createGatewayPlatformRestApp } from "./transport/api-rest/gateway-platform.api.ts";
export {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  createGatewayInternalRestApp,
  GATEWAY_SIGNATURE_WINDOW_SECONDS,
  type GatewayInternalRestPorts,
  type GatewaySpendCommandSender,
} from "./transport/api-rest/gateway-internal.api.ts";
export { GatewayInternalStorePort } from "./ports/gateway-internal-store.port.ts";
export { PrismaGatewayInternalStoreAdapter } from "./adapters/postgres.gateway-internal-store.adapter.ts";
export {
  createGatewaySpendRestApp,
  type GatewaySpendEnvelope,
  type GatewaySpendRestPorts,
  type GatewaySpendWebhookDelivery,
  type GatewaySpendWebhookEndpoint,
  type GatewaySpendWebhookEndpoints,
  type GatewaySpendWebhookEvents,
} from "./transport/api-rest/gateway-spend.api.ts";
export { type VirtualKeyTrpcSchemas } from "./transport/api-trpc/virtual-key.api.ts";

/**
 * The gateway control plane: virtual keys, budgets, guardrail evaluation, realtime voice
 * sessions, the ElevenLabs credential read, and the config bundle the Go data plane long-polls.
 */
export { VirtualKeyService } from "./services/virtual-key.service.ts";
export {
  virtualKeyBudgetInputSchema,
  type CreateVirtualKeyInput,
  type CreatedVirtualKey,
} from "./services/virtual-key-validation.service.ts";
export {
  type ActorContext,
  type MembershipSet,
  type RBACContext,
  type Scope,
  type VirtualKeyActor,
  type VirtualKeyReader,
  type VirtualKeySessionActor,
  VirtualKeyAuthorizationService,
} from "./services/virtual-key-authorization.service.ts";
export { BudgetOverviewService } from "./services/gateway-budget-overview.service.ts";
export {
  GatewayApplicableBudgetsService,
  type ApplicableBudget,
} from "./services/gateway-applicable-budgets.service.ts";
export { VirtualKeyDirectBudgetService } from "./services/virtual-key-direct-budget.service.ts";
export { GatewayConfigMaterialiserService } from "./services/gateway-config-materialisation.service.ts";
export { GatewayScopeResolutionService } from "./services/gateway-scope-resolution.service.ts";
export {
  GatewayGuardrailEvaluationService,
  type EvaluatorRunner,
} from "./services/gateway-guardrail-evaluation.service.ts";
export {
  GatewayElevenLabsCredentialService,
  ELEVENLABS_DEFAULT_BASE_URL,
  ELEVENLABS_WEBHOOK_SECRET_KEY,
  type ElevenLabsApiCredential,
  type ElevenLabsCredentialCollaborators,
  type ElevenLabsWebhookSecret,
} from "./services/gateway-elevenlabs-credential.service.ts";
export {
  GatewayRealtimeSessionService,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
  type ReserveInput,
} from "./services/gateway-realtime-session.service.ts";
export type { ReserveResult } from "./repositories/gateway-realtime-session.repository.ts";
export { GatewaySpendScopeAdapter } from "./adapters/postgres.gateway-spend-scope.adapter.ts";
export {
  GatewayJwtAdapter,
  type GatewayJwtClaims,
  type GatewayJwtSubject,
} from "./adapters/jwt.gateway-token.adapter.ts";
export {
  elevenLabsConversationReportSchema,
  GatewayRealtimeSessionReconciliationService,
  realtimeSessionReconciliationConfig,
} from "./services/gateway-realtime-session-reconciliation.service.ts";
export type {
  ElevenLabsConversationReader,
  ElevenLabsConversationReport,
  ElevenLabsCredentialReader,
  RealtimeSessionPollerHandle,
  RealtimeSessionReconciliationRepository,
} from "./services/gateway-realtime-session-reconciliation.service.ts";
export {
  GatewayGovernanceSignalsPort,
  type GatewayVirtualKeyLifecycleSignal,
} from "./ports/gateway-governance-signals.port.ts";
export { GatewayModelProviderCredentialsPort } from "./ports/gateway-model-provider-credentials.port.ts";
export {
  GatewayScopePermissionsPort,
  type GatewayPermissionScope,
} from "./ports/gateway-scope-permissions.port.ts";
export { GatewayConfigAssemblyPort } from "./ports/gateway-config-assembly.port.ts";
export { GatewayConfigAssemblyAdapter } from "./adapters/postgres.gateway-config-assembly.adapter.ts";
export { GatewayVirtualKeyCryptoPort } from "./ports/gateway-virtual-key-crypto.port.ts";
export { GatewaySpanIngestionPort } from "./ports/gateway-span-ingestion.port.ts";
export { GatewaySpendConfirmationPort } from "./ports/gateway-spend-confirmation.port.ts";
export { GatewaySpendRatingPort } from "./ports/gateway-spend-rating.port.ts";
export {
  ModelCatalogGatewaySpendRatingAdapter,
  NANO_USD_PER_USD,
  NO_RATE_RULE_CODE,
  UNPRICED_QUANTITIES_CODE,
} from "./adapters/model-catalog.gateway-spend-rating.adapter.ts";
export {
  createElevenLabsWebhookRestApp,
  verifyElevenLabsSignature,
  type ElevenLabsWebhookRestPorts,
} from "./transport/api-rest/elevenlabs-webhook.api.ts";

// The R3 config walk, main's `scripts/migrations/backfill-vk-config-to-rp.ts`.
export {
  backfillVirtualKeyConfig,
  VirtualKeyConfigBackfillTask,
  type LegacyVirtualKeyConfig,
  type VirtualKeyConfigBackfillOutcome,
} from "./tasks/virtual-key-config-backfill.task.ts";
export { PostgresGatewayVirtualKeyConfigBackfillAdapter } from "./adapters/postgres.gateway-virtual-key-config-backfill.adapter.ts";
export type {
  GatewayVirtualKeyConfigBackfillRepository,
  VirtualKeyRow,
  VirtualKeyScopeRow,
} from "./repositories/gateway-virtual-key-config-backfill.repository.ts";

// The pre-migration gate report, main's `report-trace-destination-backfill.ts`.
export {
  reportTraceDestinationBackfill,
  TRACE_DESTINATION_RESOLUTIONS,
  TraceDestinationReportTask,
  type TraceDestinationReport,
  type TraceDestinationResolution,
} from "./tasks/trace-destination-report.task.ts";
export { PostgresGatewayTraceDestinationReportAdapter } from "./adapters/postgres.gateway-trace-destination-report.adapter.ts";
export type {
  GatewayTraceDestinationReportRepository,
  TraceDestinationKeyRow,
  TraceDestinationProjectRow,
} from "./repositories/gateway-trace-destination-report.repository.ts";
