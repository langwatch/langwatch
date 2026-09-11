export { GatewayService } from "./services/gateway.service.ts";
export { gatewayServer } from "./gateway.server.ts";
export { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
export { agentCacheRest } from "./transport/agent-cache.rest.ts";
export { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
export {
  gatewaySpendBillingPlanGate,
  gatewaySpendRest,
  type GatewaySpendApp,
  type GatewaySpendEnvelope,
  type GatewaySpendWebhookDelivery,
  type GatewaySpendWebhookEndpoint,
  type GatewaySpendWebhookEndpoints,
  type GatewaySpendWebhookEvents,
} from "./transport/gateway-spend.rest.ts";
export {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  gatewayInternalRest,
  gatewayInternalSignature,
  GATEWAY_SIGNATURE_WINDOW_SECONDS,
  GatewayInternalApi,
  type GatewayCodexRefresh,
  type GatewayInternalApp,
  type GatewayInternalSpendPipeline,
  type GatewaySpendCommandSender,
} from "./transport/gateway-internal.rest.ts";
export { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
export { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
export { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
export { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
export { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
export { gatewaySessionFact, virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";
export {
  PrismaGatewayAdapter,
  type GatewayPersistence,
} from "./adapters/prisma.gateway.adapter.ts";
export { GatewaySpendEventsService } from "./services/gateway-spend-events.service.ts";
export { GatewayEndUserCapsAdapter } from "./adapters/gateway-end-user-caps.adapter.ts";
export { GatewayEndUserCapsService } from "./services/gateway-end-user-caps.service.ts";
export * from "./services/gateway-usage.service.ts";
export type { GatewayBudgetSpendRecord, BudgetBucketBoundary, BudgetSpendTarget, ScopeSpend, BucketSpend, LedgerEventRow, BudgetDebitRow, PulledUsageRow, PulledUsageTotals, GatewayBudgetSpend as GatewayBudgetSpend } from "./app/gateway.members.ts";
export type { GatewayChangeEventKind, GatewayChangeEvent, AppendGatewayChangeEventInput, GatewayPersistenceTransaction, GatewayChangeEvents as GatewayChangeEvents } from "./app/gateway.members.ts";
export type { GatewayAuditAction, GatewayAuditTargetKind, AppendGatewayAuditInput, GatewayAuditTransaction, GatewayAudit as GatewayAudit } from "./app/gateway.members.ts";
export * from "./ports/gateway-virtual-key.port.ts";
export type { GatewayClickHouseClient, GatewayClickHouseResolver, GatewayClickHouse as GatewayClickHouse } from "./app/gateway.members.ts";
export type { GatewaySettlementPolicy } from "./app/gateway.members.ts";
export * from "./ports/gateway-spend-events.port.ts";
export type { GatewayVirtualKeySpendRow, GatewaySpendWindow, GatewayUsageBucket, GatewayTraceRow, GatewayVirtualKeySpend } from "./app/gateway.members.ts";
export * from "./adapters/fixed-gateway-settlement.adapter.ts";
export {
  GatewayBudgetClickHouseRepository,
} from "./repositories/clickhouse/clickhouse.gateway-budget.repository.ts";
export * from "./intents/gateway-spend.intent.ts";
export {
  GatewaySpendEventsRepository,
} from "./repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts";
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
  spendUsageSchema,
  type SpendUsage,
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
  type GatewayBudgetResolutionApi,
  type GatewayBudgetResolutionDatabase,
} from "./adapters/postgres.gateway-budget-resolution.adapter.ts";
export type { GatewaySpendState } from "./projections/gateway-spend.projection.ts";
export * from "./adapters/gateway-wire-pagination.adapter.ts";
export * from "./adapters/virtual-key-crypto.adapter.ts";
export type * from "./services/gateway.service.ts";

/**
 * The feature's application: the one thing every door is given, holding every
 * service and port the seven transports reach and owning the virtual-key write
 * pre-flight both doors used to run for themselves.
 */
export {
  GatewayApp,
  type GatewayActor,
  type GatewayAppDependencies,
  type GatewayInfrastructure,
  type GatewayRestInfrastructure,
  type GatewayApplicableBudgetTarget,
  type GatewayVirtualKeyBudgetInput,
  type GatewayVirtualKeyOperations,
} from "./app/gateway.app.ts";
export { GatewayInternalStore } from "./repositories/gateway-internal-store.repository.ts";
export { PrismaGatewayInternalStoreRepository } from "./repositories/prisma/prisma.gateway-internal-store.repository.ts";
export { MemoryGatewayInternalStoreRepository } from "./repositories/memory/memory.gateway-internal-store.repository.ts";

/**
 * The gateway control plane: virtual keys, budgets, guardrail evaluation, realtime voice
 * sessions, the ElevenLabs credential read, and the config bundle the Go data plane long-polls.
 */
export { VirtualKeyService } from "./services/virtual-key.service.ts";
export {
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
export type {
  GatewayGovernanceSignals,
  GatewayVirtualKeyLifecycleSignal,
} from "./app/gateway.members.ts";
export type { GatewayModelProviderCredentials } from "./app/gateway.members.ts";
export type {
  GatewayScopePermissions,
  GatewayPermissionScope,
} from "./app/gateway.members.ts";
export type { GatewayConfigAssembly } from "./app/gateway.members.ts";
export { GatewayConfigAssemblyAdapter } from "./adapters/postgres.gateway-config-assembly.adapter.ts";
export type { GatewayVirtualKeyCrypto } from "./app/gateway.members.ts";
export type { GatewaySpanIngestion } from "./app/gateway.members.ts";
export type { GatewaySpendConfirmation } from "./app/gateway.members.ts";
export type { GatewaySpendRating } from "./app/gateway.members.ts";
export {
  ModelCatalogGatewaySpendRatingAdapter,
  NANO_USD_PER_USD,
  NO_RATE_RULE_CODE,
  UNPRICED_QUANTITIES_CODE,
} from "./adapters/model-catalog.gateway-spend-rating.adapter.ts";

// The R3 config walk, main's `scripts/migrations/backfill-vk-config-to-rp.ts`.
export {
  backfillVirtualKeyConfig,
  VirtualKeyConfigBackfillTask,
  type LegacyVirtualKeyConfig,
  type VirtualKeyConfigBackfillOutcome,
} from "./tasks/virtual-key-config-backfill.task.ts";
export {
  PrismaGatewayVirtualKeyConfigBackfillRepository,
} from "./repositories/prisma/prisma.gateway-virtual-key-config-backfill.repository.ts";
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
export {
  PrismaGatewayTraceDestinationReportRepository,
} from "./repositories/prisma/prisma.gateway-trace-destination-report.repository.ts";
export type {
  GatewayTraceDestinationReportRepository,
  TraceDestinationKeyRow,
  TraceDestinationProjectRow,
} from "./repositories/gateway-trace-destination-report.repository.ts";
export {
  BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
  GatewayBudgetChangeDedupeService,
  type BudgetChangeEventDedupeService,
} from "./services/gateway-budget-change-dedupe.service.ts";
export { GatewayBudgetChangeDedupeRepository } from "./repositories/gateway-budget-change-dedupe.repository.ts";
export { RedisGatewayBudgetChangeDedupeRepository } from "./repositories/redis/redis.gateway-budget-change-dedupe.repository.ts";
