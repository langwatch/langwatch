export { GatewayService } from "./services/gateway.service";
export { PrismaGatewayAdapter, type GatewayPersistence } from "./adapters/prisma.gateway.adapter";
export { GatewaySpendEventsService } from "./services/gateway-spend-events.service";
export { GatewayEndUserCapsAdapter } from "./adapters/gateway-end-user-caps.adapter";
export { GatewayEndUserCapsService } from "./services/gateway-end-user-caps.service";
export * from "./services/gateway-usage.service";
export { GatewayBudgetSpendPort } from "./ports/gateway-budget-spend.port";
export * from "./ports/gateway-budget-spend.port";
export * from "./ports/gateway-change-events.port";
export * from "./ports/gateway-audit.port";
export * from "./ports/gateway-virtual-key.port";
export * from "./ports/gateway-clickhouse.port";
export * from "./ports/gateway-settlement-policy.port";
export * from "./ports/gateway-spend-events.port";
export * from "./ports/gateway-virtual-key-spend.port";
export * from "./adapters/fixed-gateway-settlement.adapter";
export * from "./adapters/gateway-virtual-key-spend.adapter";
export * from "./adapters/gateway-budget-ledger.adapter";
export * from "./adapters/gateway-spend-events.adapter";
export * from "./adapters/gateway-spend-events-clickhouse.adapter";
export * from "./adapters/gateway-spend-cursor.adapter";
export * from "./adapters/gateway-spend-fold.adapter";
export { budgetPeriodFloorMs, currentPeriodStart } from "./adapters/gateway-period.adapter";
export {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  budgetAppliesToProvider,
} from "./adapters/gateway-bucket-scope.adapter";
export { spendTargetsForBudgets } from "./adapters/gateway-budget-spend-target.adapter";
export * from "./adapters/gateway-audit-serializer.adapter";
export * from "./adapters/gateway-budget-dto.adapter";
export * from "./adapters/gateway-virtual-key-dto.adapter";
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
export * from "./adapters/gateway-period.adapter";
export * from "./adapters/gateway-resource-metadata.adapter";
export * from "./adapters/gateway-spend-filters.adapter";
export * from "./adapters/gateway-spend-grouping.adapter";
export * from "./processes/gateway-spend-commands.process";
export * from "./processes/gateway-spend-settlement.process";
export * from "./intents/gateway-spend-settlement.intent";
export * from "./ports/gateway-open-admissions.port";
export * from "./adapters/clickhouse.gateway-open-admissions.adapter";
export * from "./intents/gateway-spend.intent";
export * from "./adapters/eventing.gateway-spend.adapter";
export {
  PostgresGatewayBudgetResolutionAdapter,
  type GatewayBudgetResolutionDatabase,
} from "./adapters/postgres.gateway-budget-resolution.adapter";
export type { GatewaySpendState } from "./projections/gateway-spend.projection";
export * from "./adapters/gateway-spend-constants.adapter";
export * from "./adapters/gateway-spend-events.adapter";
export * from "./adapters/gateway-window.adapter";
export * from "./adapters/gateway-wire-pagination.adapter";
export * from "./adapters/gateway-routing-policy-select.adapter";
export * from "./adapters/virtual-key-crypto.adapter";
export type * from "./services/gateway.service";
export type * from "./ports/gateway-budget-spend.port";

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
} from "./app/gateway.app";

/**
 * The app-process tRPC transports this feature owns. The process supplies its
 * root, authenticated procedure and policy chain; the procedure names, input
 * schemas, access declarations and delegation are the feature's.
 */
export {
  GatewayBudgetTrpcApi,
  type GatewayBudgetTrpcContext,
} from "./transport/api-trpc/gateway-budget.api";
export {
  GatewayCacheRuleTrpcApi,
  type GatewayCacheRuleTrpcContext,
} from "./transport/api-trpc/gateway-cache-rule.api";
export {
  GatewayGuardrailTrpcApi,
  type GatewayGuardrailTrpcContext,
} from "./transport/api-trpc/gateway-guardrail.api";
export {
  GatewaySpendEventTrpcApi,
  type GatewaySpendEventTrpcContext,
} from "./transport/api-trpc/gateway-spend-event.api";
export {
  GatewayUsageTrpcApi,
  type GatewayUsageTrpcContext,
} from "./transport/api-trpc/gateway-usage.api";
export {
  VirtualKeyTrpcApi,
  type VirtualKeyTrpcContext,
} from "./transport/api-trpc/virtual-key.api";

/**
 * The public REST family this feature owns. The process supplies the bound REST
 * security service and the application; the routes, wire casing and access
 * declarations are the feature's, so the REST and tRPC doors cannot drift
 * apart.
 */
export { createGatewayPlatformRestApp } from "./transport/api-rest/gateway-platform.api";
export {
  createGatewaySpendRestApp,
  type GatewaySpendEnvelope,
  type GatewaySpendRestPorts,
  type GatewaySpendWebhookDelivery,
  type GatewaySpendWebhookEndpoint,
  type GatewaySpendWebhookEndpoints,
  type GatewaySpendWebhookEvents,
} from "./transport/api-rest/gateway-spend.api";
export { type VirtualKeyTrpcSchemas } from "./transport/api-trpc/virtual-key.api";

/**
 * The gateway control plane, moved out of the retired application.
 *
 * Virtual keys and their scope authorization, the budget overview and the
 * budgets applicable to one target, guardrail evaluation, the realtime voice
 * session record, the ElevenLabs credential read, and the configuration
 * bundle the Go data plane long-polls for — plus the four ports those need
 * that belong to other features or to the deployment.
 */
export {
  VirtualKeyService,
  virtualKeyBudgetInputSchema,
  type CreateVirtualKeyInput,
  type CreatedVirtualKey,
} from "./services/virtual-key.service";
export {
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertCanManageAllScopes,
  assertCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  loadMembershipSet,
  requireExistingVk,
  requireVisibleVk,
  resolveVkProjectId,
  type ActorContext,
  type MembershipSet,
  type RBACContext,
  type Scope,
  type VirtualKeyActor,
  type VirtualKeyReader,
  type VirtualKeySessionActor,
} from "./services/virtual-key-authorization.service";
export { BudgetOverviewService } from "./services/gateway-budget-overview.service";
export {
  resolveApplicableBudgetsForDraftKey,
  resolveApplicableBudgetsForTarget,
  type ApplicableBudget,
} from "./services/gateway-applicable-budgets.service";
export { loadDirectBudgetsForKeys } from "./services/virtual-key-direct-budget.service";
export {
  GatewayConfigMaterialiser,
  buildCredentials,
} from "./services/gateway-config-materialisation.service";
export {
  getElevenLabsApiCredential,
  getElevenLabsWebhookSecret,
  ELEVENLABS_DEFAULT_BASE_URL,
  ELEVENLABS_WEBHOOK_SECRET_KEY,
  type ElevenLabsApiCredential,
  type ElevenLabsCredentialCollaborators,
  type ElevenLabsWebhookSecret,
} from "./services/gateway-elevenlabs-credential.service";
export {
  closeAndConfirmRealtimeSession,
  correlateRealtimeSession,
  expireStaleRealtimeSessions,
  matchRealtimeSession,
  releaseRealtimeSession,
  reportRealtimeSessionUsage,
  reserveRealtimeSession,
  REALTIME_OPEN_SESSION_WINDOW_MS,
  type GatewayRealtimeSessionCollaborators,
  type ReserveInput,
  type ReserveResult,
} from "./services/gateway-realtime-session.service";
export { GatewaySpendScopeAdapter } from "./adapters/gateway-spend-scope.adapter";
export {
  GatewayJwtAdapter,
  type GatewayJwtClaims,
  type GatewayJwtSubject,
} from "./adapters/jwt.gateway-token.adapter";
export { withTierFallthrough } from "./adapters/gateway-model-tier-fallthrough.adapter";
export { declaredModelsForProvider } from "./adapters/gateway-provider-model-catalog.adapter";
export { recordRealtimeSessionSpan } from "./adapters/gateway-realtime-session-span.adapter";
export {
  GatewayGovernanceSignalsPort,
  type GatewayVirtualKeyLifecycleSignal,
} from "./ports/gateway-governance-signals.port";
export { GatewayModelProviderCredentialsPort } from "./ports/gateway-model-provider-credentials.port";
export {
  GatewayScopePermissionsPort,
  type GatewayPermissionScope,
} from "./ports/gateway-scope-permissions.port";
export { GatewaySpanIngestionPort } from "./ports/gateway-span-ingestion.port";
export { GatewaySpendConfirmationPort } from "./ports/gateway-spend-confirmation.port";
export { GatewaySpendRatingPort } from "./ports/gateway-spend-rating.port";
