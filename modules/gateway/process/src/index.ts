/**
 * The feature declaration, and what another package composes from this
 * feature: the advisory dedupe window a spend graph debits through.
 */
export { gatewayProcessModule, createGatewayBudgetChangeDedupe } from "./gateway.module.ts";
export { gatewayBudgetTrpcTransport } from "./transport/gateway-budget.trpc.ts";
export { agentCacheRest } from "./transport/agent-cache.rest.ts";
export { gatewayPlatformRest } from "./transport/gateway-platform.rest.ts";
export { gatewaySpendRest } from "./transport/gateway-spend.rest.ts";
export type { GatewaySpendApp } from "./features/spend/services/gateway-spend-reconciliation.service.ts";
export { gatewayInternalRest } from "./transport/gateway-internal.rest.ts";
export { elevenLabsSignature, elevenLabsWebhookRest } from "./transport/elevenlabs-webhook.rest.ts";
export { gatewayCacheRuleTrpcTransport } from "./transport/gateway-cache-rule.trpc.ts";
export { gatewayGuardrailTrpcTransport } from "./transport/gateway-guardrail.trpc.ts";
export { gatewayUsageTrpcTransport } from "./transport/gateway-usage.trpc.ts";
export { gatewaySpendEventTrpcTransport } from "./transport/gateway-spend-event.trpc.ts";
export { gatewaySessionFact, virtualKeyTrpcTransport } from "./transport/virtual-key.trpc.ts";
export type {
  GatewayUsageProjects,
  GatewayUsageVirtualKeys,
  UsageSummary,
  UsageWindow,
  VirtualKeyUsageSummary,
} from "./features/spend/services/gateway-spend-summary.service.ts";
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
  GatewayBudgetSpendRepository,
} from "./repositories/gateway-budget-spend.repository.ts";
export type {
  GatewayChangeEventKind,
  GatewayChangeEvent,
  AppendGatewayChangeEventInput,
  GatewayChangeEventsRepository,
} from "./repositories/gateway-change-event.repository.ts";
export type { GatewayPersistenceTransaction } from "./repositories/gateway-transaction.repository.ts";
export type {
  GatewayAuditAction,
  GatewayAuditTargetKind,
  AppendGatewayAuditInput,
  GatewayAuditTransaction,
  GatewayAuditRepository,
} from "./repositories/gateway-audit.repository.ts";
export type {
  GatewayClickHouseClient,
  GatewayClickHouseResolver,
  GatewayClickHouse,
} from "./repositories/clickhouse/clickhouse.gateway-session.store.ts";
export type { GatewaySettlementPolicy } from "./rules/gateway-spend-grouping.rules.ts";
export * from "./eventing/gateway-spend.intent.ts";
export {
  GatewayBudgetCycleAnchorInvalidError,
  GatewayBudgetNotFoundError,
  GatewayBudgetScopeUnreachableError,
  GatewayExternalIdConflictError,
  GatewayGroupBudgetUnsupportedError,
  GatewayGuardrailProjectMismatchError,
  GatewayScopeOrgMismatchError,
  GatewaySpendGroupByUnstableError,
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
export * from "./eventing/gateway-spend-commands.process.ts";
export * from "./eventing/gateway-spend-settlement.process.ts";
export * from "./eventing/gateway-spend-settlement.intent.ts";
export type {
  GatewayClickHouseInstance,
  GatewayClickHouseInstanceResolver,
} from "./repositories/clickhouse/clickhouse.gateway-open-admissions-sweep.repository.ts";
export type { OpenAdmission } from "./repositories/gateway-open-admissions.repository.ts";
export type { GatewaySpendState } from "./eventing/gateway-spend.projection.ts";
export type * from "./services/gateway.service.ts";

/**
 * The gateway control plane: virtual keys, budgets, guardrail evaluation, realtime voice
 * sessions, the ElevenLabs credential read, and the config bundle the Go data plane long-polls.
 */
export type {
  CreateVirtualKeyInput,
  CreatedVirtualKey,
} from "./features/virtual-key/services/virtual-key-validation.service.ts";
export type {
  ActorContext,
  MembershipSet,
  RBACContext,
  Scope,
  VirtualKeyActor,
  VirtualKeyReader,
  VirtualKeySessionActor,
} from "./features/virtual-key/services/virtual-key-authorization.service.ts";
export type { ApplicableBudget } from "./features/budget/services/gateway-applicable-budgets.service.ts";
export type {
  ElevenLabsApiCredential,
  ElevenLabsCredentialCollaborators,
  ElevenLabsWebhookSecret,
} from "./services/gateway-elevenlabs-credential.service.ts";
export type {
  GatewayRealtimeSessionCollaborators,
  ReserveInput,
} from "./features/realtime-session/services/gateway-realtime-session.service.ts";
export type { ReserveResult } from "./repositories/gateway-realtime-session.repository.ts";
export type { GatewayJwtClaims, GatewayJwtSubject } from "./services/gateway-jwt.service.ts";
export type { ElevenLabsCredentialReader } from "./features/realtime-session/services/gateway-realtime-session-reconciliation.service.ts";
export {
  elevenLabsConversationReportSchema,
  type ElevenLabsConversationChannel,
  type ElevenLabsConversationReport,
} from "./channels/elevenlabs-conversation.channel.ts";
export type {
  GatewayGovernanceSignals,
  GatewayVirtualKeyLifecycleSignal,
} from "./services/gateway-governance-events.service.ts";
export type { GatewayModelProviderCredentials } from "./rules/gateway-config-wire.rules.ts";
export type {
  GatewayScopePermissions,
  GatewayPermissionScope,
} from "./features/virtual-key/services/virtual-key-authorization.service.ts";
export type { GatewayConfigAssembly } from "./rules/gateway-config-wire.rules.ts";
export type { GatewayVirtualKeyCrypto } from "./features/virtual-key/services/virtual-key-crypto.service.ts";
export type { GatewaySpanIngestion } from "./features/realtime-session/services/gateway-realtime-settlement-span.service.ts";
export type { GatewaySpendConfirmation } from "./features/realtime-session/services/gateway-realtime-session.service.ts";
export type { GatewaySpendRating } from "./features/spend/services/model-catalog-gateway-spend-rating.service.ts";

// The R3 config walk, main's `scripts/migrations/backfill-vk-config-to-rp.ts`.
export {
  backfillVirtualKeyConfig,
  VirtualKeyConfigBackfillTask,
  type LegacyVirtualKeyConfig,
  type VirtualKeyConfigBackfillOutcome,
} from "./tasks/virtual-key-config-backfill.task.ts";
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
export type {
  TraceDestinationKeyRow,
  TraceDestinationProjectRow,
} from "./repositories/gateway-trace-destination-report.repository.ts";
export type { BudgetChangeEventDedupeService } from "./features/budget/services/gateway-budget-change-dedupe.service.ts";
