/**
 * The feature declaration, and what another package composes from this
 * feature: the advisory dedupe window a spend graph debits through, and the
 * poller that settles brokered voice sessions the vendor never reported.
 */
export {
  gatewayServer,
  createGatewayBudgetChangeDedupe,
  createGatewayRealtimeSessionReconciliation,
  type ElevenLabsConversationSource,
  type GatewayRealtimeSessionReconciliationSubstrates,
} from "./gateway.server.ts";
export { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
export { agentCacheRest } from "./transport/agent-cache.rest.ts";
export { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
export {
  gatewaySpendBillingPlanGate,
  gatewaySpendRest,
  type GatewaySpendApp,
  type GatewaySpendWebhookDelivery,
  type GatewaySpendWebhookEndpoint,
  type GatewaySpendWebhookEndpoints,
  type GatewaySpendWebhookEvents,
} from "./transport/gateway-spend.rest.ts";
export {
  buildGatewayCanonicalString,
  computeGatewaySignature,
  GATEWAY_SIGNATURE_WINDOW_SECONDS,
} from "./rules/gateway-internal-identity.rules.ts";
export { GatewayInternalIdentityService } from "./services/gateway-internal-identity.service.ts";
export { gatewayInternalRest } from "./transport/gateway-internal.rest.ts";
export { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
export { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
export { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
export { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
export { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
export { gatewaySessionFact, virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";
export { PrismaGatewayAdapter, type GatewayPersistence } from "./app/prisma.gateway.composition.ts";
export { GatewayEndUserCapsAdapter } from "./app/gateway-end-user-caps.composition.ts";
export type {
  GatewayUsageProjects,
  GatewayUsageVirtualKeys,
  UsageSummary,
  UsageWindow,
  VirtualKeyUsageSummary,
} from "./services/gateway-usage.service.ts";
export type {
  GatewayBudgetSpendRecord,
  BudgetBucketBoundary,
  BudgetSpendTarget,
  ScopeSpend,
  BucketSpend,
  LedgerEventRow,
  BudgetDebitRow,
  PulledUsageRow,
  PulledUsageTotals,
  GatewayBudgetSpend,
} from "./app/gateway.members.ts";
export type {
  GatewayChangeEventKind,
  GatewayChangeEvent,
  AppendGatewayChangeEventInput,
  GatewayPersistenceTransaction,
  GatewayChangeEvents,
} from "./app/gateway.members.ts";
export type {
  GatewayAuditAction,
  GatewayAuditTargetKind,
  AppendGatewayAuditInput,
  GatewayAuditTransaction,
  GatewayAudit,
} from "./app/gateway.members.ts";
export type {
  GatewayClickHouseClient,
  GatewayClickHouseResolver,
  GatewayClickHouse,
} from "./app/gateway.members.ts";
export type { GatewaySettlementPolicy } from "./app/gateway.members.ts";
export * from "./services/fixed-gateway-settlement-policy.service.ts";
export { GatewayBudgetClickHouseRepository } from "./repositories/clickhouse/clickhouse.gateway-budget.repository.ts";
export * from "./eventing/gateway-spend.intent.ts";
export { ClickHouseGatewaySpendEventsRepository } from "./repositories/clickhouse/clickhouse.gateway-spend-events.repository.ts";
export * from "./rules/gateway-spend-cursor.rules.ts";
export * from "./services/gateway-budget-dto.service.ts";
export * from "./services/gateway-virtual-key-dto.service.ts";
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
export * from "./rules/gateway-spend-filters.rules.ts";
export * from "./rules/gateway-spend-grouping.rules.ts";
export * from "./eventing/gateway-spend-commands.process.ts";
export * from "./eventing/gateway-spend-settlement.process.ts";
export * from "./eventing/gateway-spend-settlement.intent.ts";
export {
  ClickHouseGatewayOpenAdmissionsAdapter,
  type GatewayClickHouseInstance,
  type GatewayClickHouseInstanceResolver,
} from "./repositories/clickhouse/clickhouse.gateway-open-admissions.adapter.ts";
export type { OpenAdmission } from "./repositories/gateway-open-admissions.repository.ts";
export * from "./eventing/gateway-spend.adapter.ts";
export { GatewaySpendProducerAdapter } from "./eventing/gateway-spend-producer.ts";
export {
  PostgresGatewayBudgetResolutionAdapter,
  type GatewayBudgetResolutionApi,
  type GatewayBudgetResolutionDatabase,
} from "./repositories/prisma/postgres.gateway-budget-resolution.adapter.ts";
export type { GatewaySpendState } from "./eventing/gateway-spend.projection.ts";
export * from "./rules/gateway-wire-pagination.rules.ts";
export * from "./services/virtual-key-crypto.service.ts";
export type * from "./services/gateway.service.ts";

/**
 * The feature's application: the one thing every door is given, holding every
 * service and port the seven transports reach and owning the virtual-key write
 * pre-flight both doors used to run for themselves.
 */
export type {
  GatewayActor,
  GatewayAppDependencies,
  GatewayInfrastructure,
  GatewayRestInfrastructure,
  GatewayApplicableBudgetTarget,
  GatewayVirtualKeyBudgetInput,
  GatewayVirtualKeyOperations,
} from "./app/gateway.app.ts";

/**
 * The gateway control plane: virtual keys, budgets, guardrail evaluation, realtime voice
 * sessions, the ElevenLabs credential read, and the config bundle the Go data plane long-polls.
 */
export type {
  CreateVirtualKeyInput,
  CreatedVirtualKey,
} from "./services/virtual-key-validation.service.ts";
export type {
  ActorContext,
  MembershipSet,
  RBACContext,
  Scope,
  VirtualKeyActor,
  VirtualKeyReader,
  VirtualKeySessionActor,
} from "./services/virtual-key-authorization.service.ts";
export type { ApplicableBudget } from "./services/gateway-applicable-budgets.service.ts";
export type { EvaluatorRunner } from "./services/gateway-guardrail-evaluation.service.ts";
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
export { PrismaGatewaySpendScopeRepository } from "./repositories/prisma/prisma.gateway-spend-scope.repository.ts";
export {
  GatewayJwtService,
  type GatewayJwtClaims,
  type GatewayJwtSubject,
} from "./services/gateway-jwt.service.ts";
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
} from "./services/gateway-realtime-session-reconciliation.service.ts";
export type {
  GatewayGovernanceSignals,
  GatewayVirtualKeyLifecycleSignal,
} from "./app/gateway.members.ts";
export type { GatewayModelProviderCredentials } from "./app/gateway.members.ts";
export type { GatewayScopePermissions, GatewayPermissionScope } from "./app/gateway.members.ts";
export type { GatewayConfigAssembly } from "./app/gateway.members.ts";
export { GatewayConfigAssemblyAdapter } from "./app/gateway-config-assembly.composition.ts";
export type { GatewayVirtualKeyCrypto } from "./app/gateway.members.ts";
export type { GatewaySpanIngestion } from "./app/gateway.members.ts";
export type { GatewaySpendConfirmation } from "./app/gateway.members.ts";
export type { GatewaySpendRating } from "./app/gateway.members.ts";
export { ModelCatalogGatewaySpendRatingService } from "./services/model-catalog-gateway-spend-rating.service.ts";

// The R3 config walk, main's `scripts/migrations/backfill-vk-config-to-rp.ts`.
export {
  backfillVirtualKeyConfig,
  VirtualKeyConfigBackfillTask,
  type LegacyVirtualKeyConfig,
  type VirtualKeyConfigBackfillOutcome,
} from "./tasks/virtual-key-config-backfill.task.ts";
export { PrismaGatewayVirtualKeyConfigBackfillRepository } from "./repositories/prisma/prisma.gateway-virtual-key-config-backfill.repository.ts";
export type {
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
export { PrismaGatewayTraceDestinationReportRepository } from "./repositories/prisma/prisma.gateway-trace-destination-report.repository.ts";
export type {
  TraceDestinationKeyRow,
  TraceDestinationProjectRow,
} from "./repositories/gateway-trace-destination-report.repository.ts";
export {
  BUDGET_CHANGE_EVENT_WINDOW_SECONDS,
  GatewayBudgetChangeDedupeService,
  type BudgetChangeEventDedupeService,
} from "./services/gateway-budget-change-dedupe.service.ts";
export { RedisGatewayBudgetChangeDedupeRepository } from "./repositories/redis/redis.gateway-budget-change-dedupe.repository.ts";
