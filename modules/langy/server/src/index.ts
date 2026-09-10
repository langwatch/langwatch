export {
  PostgresLangyAdapter,
  type LangyCredentialComposition,
  type LangyServiceCompositionOptions,
  LangyEventingMembers,
  LangyTrustedMessage,
  type PostgresLangyAdapterOptions,
} from "./services/langy-postgres.service.ts";
/**
 * The Langy feature's conversation-and-turn service, folded out of the
 * contract package (ADR-133: no standalone contract-service class). Peer
 * code that still needs the concrete class (composition tests asserting the
 * built instance) imports the type from here now.
 */
export { LangyService } from "./services/langy.service.ts";
export type { LangyInfrastructure } from "./app/langy.app.ts";
export { langyServer } from "./langy.server.ts";
export { LangyNavigateFallbackService } from "./services/langy-navigate-fallback.service.ts";
export { LangyNavigateProject } from "./app/langy.members.ts";
export { LangyNavigateResource } from "./app/langy.members.ts";
export {
  LANGY_NAVIGATE_RESOURCE_KINDS,
  type LangyNavigateResourceKind,
  navigateResourceKindFor,
} from "./rules/langy-navigate-resources.rules.ts";
export type { LangyRelayCompositionOptions } from "./services/langy-postgres.service.ts";
export type { LangyDatabase } from "./repositories/prisma/langy-database.mapper.ts";
export type { LangyTurnTechnicalMembers } from "./services/langy-turn.service.ts";
export {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyService,
} from "./services/langy-session-key.service.ts";
export { LangySessionKeyMetrics } from "./app/langy.members.ts";
export { LangySessionKeyReapService } from "./services/langy-session-key-reap.service.ts";
export { LangySessionKeyReapRepository } from "./repositories/langy-session-key-reap.repository.ts";
export {
  OtelLangySessionKeyMetricsAdapter,
  LANGY_SESSION_KEYS_METRIC_NAME,
} from "./services/langy-session-key-metrics-otel.service.ts";
export {
  PrismaLangySessionKeyReapRepository,
  type PrismaLangySessionKeyReapDatabase,
} from "./repositories/prisma/prisma.langy-session-key-reap.repository.ts";
export type { LangySessionKeyRevocation } from "./services/langy-session-key.service.ts";
export { ADOPTABLE_CONVERSATION_ID } from "./services/langy.service.ts";
export type {
  LangyConversationCommands,
  LangyConversationEventsReader,
  LangyConversationRuntime,
  OpenLangyRelay,
} from "./services/langy.service.ts";
export type { LangyTurnAdmissionCapability } from "@langwatch/langy-contract";
export {
  LangyApp,
  type LangyBroadcast,
  type LangyEgressState,
  type LangyRedis,
  type LangyTurnRequest,
  type LangyTurnStream,
} from "./app/langy.app.ts";
// `langy.*` and `langyEgress.*` are not exported: they still name the deleted
// legacy builder, so nothing may reach them until each is converted to the
// declared `defineTrpcRouter` shape. `setupSkills.*` is converted and exported
// below.
export { SetupSkillsService, type SetupSkillId } from "./services/setup-skills.service.ts";
export { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";
// The agent-to-page UI-action channel. Moved here whole from the application
// that used to hold it; the one thing it could not bring is the workbench's
// action manifest, which arrives as {@link LangyUiActionCatalog}.
export {
  LangyUiActionService,
  uiActionKeys,
  UI_ACTION_CLAIM_WINDOW_MS,
  UI_ACTION_DEFAULT_BUDGET_MS,
  UI_ACTION_MAX_BUDGET_MS,
  type UiActionBackendRunner,
  type UiActionBlockingRedis,
  type UiActionCompletion,
  type UiActionConversations,
  type UiActionOutcome,
  type UiActionRedis,
} from "./services/langy-ui-action.service.ts";
export {
  type LangyUiActionBackendMode,
  LangyUiActionCatalog,
  type LangyUiActionDefinition,
} from "./app/langy.members.ts";
export {
  type LangyBackendActor,
  type LangyBackendRunResult,
  type LangyBackendSaveResult,
  type LangyBackendStateRead,
  LangyUiActionBackend,
} from "./app/langy.members.ts";
export { LangyUiActionBackendService } from "./services/langy-ui-action-backend.service.ts";

// Application-facing Langy orchestration primitives. These are deliberately
// exported from the package root so the application never couples itself to
// the feature's private repository/service layout.
export { LangyCliEnvelopeService } from "./services/langy-cli-envelope.service.ts";
export type { LangyToolFrame } from "./services/langy-cli-envelope.service.ts";
export { LangyFinalPartsService } from "./services/langy-final-parts.service.ts";
export type { LangyConversationProcessingEvent } from "./projections/langy-conversation-state.projection.ts";
export {
  computeFrameMac,
  mintRunToken,
  newFrameNonce,
  signFrame,
  verifyFrame,
} from "./services/langy-frame-auth.service.ts";
export { LANGY_AGENT_DISPATCH_TIMEOUT_MS } from "./processes/langy-conversation-process.types.ts";
export {
  AGENT_DISPATCH_TIMEOUT_MS,
  LangyWorkerHttpAdapter,
} from "./services/langy-worker-http.service.ts";
export type {
  LangyDispatchOutcome,
  LangyWorkerAdapterConfig,
  LangyWorkerHttpConfig,
} from "./services/langy-worker-http.service.ts";
export { NullLangyWorkerMetricsAdapter } from "./services/langy-worker-metrics-null.service.ts";
export { NullLangyBlockMetricsAdapter } from "./services/langy-block-metrics-null.service.ts";
export { UnavailableLangyWorkerAdapter } from "./services/langy-worker-unavailable.service.ts";
export {
  LANGY_UI_ACTIONS_FLAG,
  LangyBlockMetrics,
  LangyGithubPermit,
  LangyUiActionSurface,
  LangyWorkerMetrics,
  LangyWorker,
} from "./app/langy.members.ts";
export type {
  LangyWorkerCancelInput,
  LangyWorkerDispatchInput,
  LangyWorkerProbeInput,
  LangyWorkerWarmInput,
} from "./app/langy.members.ts";
export { FeatureFlagLangyUiActionSurfaceAdapter } from "./services/langy-ui-action-surface.service.ts";
export { LangyConversationPipelineAdapter } from "./services/langy-conversation-pipeline.service.ts";
export type { LangyConversationProcessingPipelineDeps } from "./services/langy-conversation-pipeline.service.ts";
export {
  EventingLangyConversationAdapter,
  type EventingLangyConversationAdapterOptions,
  type RedisLangyConversationRuntimeRepository,
} from "./repositories/redis/redis.langy-conversation-runtime.repository.ts";
export { RedisLangyConversationProducerRepository } from "./repositories/redis/redis.langy-conversation-producer.repository.ts";
export {
  EventingLangyMaintenanceAdapter,
  type LangyMaintenancePipelineDeps,
} from "./services/langy-maintenance.service.ts";
export {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapWake,
  type LangySessionKeyReapState,
} from "./processes/langy-session-key-reap.process.ts";
export {
  runLangySessionKeyReap,
  type LangySessionKeyReapDeps,
} from "./intents/langy-session-key-reap.intent.ts";
export type { LangyAnalyticsEventProjectionRecord } from "./projections/langy-analytics-event.projection.ts";
export { LangyAnalyticsEventStorageAdapter } from "./services/langy-analytics-event-storage.service.ts";
export { LangyAnalyticsEventMemoryRepository } from "./repositories/memory/memory.langy-analytics-event.repository.ts";
export { LangyMemoryStore } from "./repositories/memory/langy-memory.store.ts";
export { langyRepositories } from "./repositories/langy-repositories.registry.ts";
export { MemoryLangyRepositories } from "./repositories/memory/memory.langy.repositories.ts";
export { PostgresLangyRepositories } from "./repositories/prisma/prisma.langy.repositories.ts";
export type { LangyRepositories } from "./repositories/langy-repositories.registry.ts";
export {
  LangyAnalyticsEventClickHouseRepository,
  type LangyAnalyticsClickHouseClientResolver,
  type LangyAnalyticsClickHouseWriteClient,
} from "./repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
export { LangyAnalyticsEventSink } from "./repositories/langy-analytics-event.repository.ts";
export type { LangyAnalyticsEventRecord } from "./repositories/langy-analytics-event.repository.ts";
export type { LangyEffectMembers } from "./app/langy.members.ts";
export type { LangyTitleGenerator } from "./app/langy.members.ts";
export { LangyTitleModel } from "./app/langy.members.ts";
export {
  LANGY_TITLE_FEATURE_KEY,
  LangyTitleGeneratorService,
  type LangyTitleGeneratorDeps,
} from "./services/langy-title-generator.service.ts";
export {
  RedisLangyEffectRepository,
  type CreateLangyEffectPortsOptions,
} from "./repositories/redis/redis.langy-effect.repository.ts";
export {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
  LANGY_HEARTBEAT_GRACE_MS,
} from "./subscribers/langy-conversation.subscriber.ts";
export type {
  AgentTurnLivenessSubscriberDeps,
  LangyConversationFreshnessReader,
  LangyConversationFreshnessRecord,
  LangyConversationLivenessReader,
  LangyConversationLivenessRecord,
  LangyConversationUpdateChannel,
  LangyConversationUpdateBroadcastSubscriberDeps,
  LangyFailTurnCommand,
} from "./subscribers/langy-conversation.subscriber.ts";
export type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./app/langy.members.ts";
export { LangyFrameDedupRedisRepository } from "./repositories/redis/redis.langy-frame-dedup.repository.ts";
export type { LangyFrameDedupRedis } from "./repositories/redis/redis.langy-frame-dedup.repository.ts";
export type {
  LangyFrameDedupRepository,
  LangyResourceLinksRepository,
} from "./repositories/langy-live-turn.repository.ts";
export { LangyResourceLinksRedisRepository } from "./repositories/redis/redis.langy-resource-links.repository.ts";
export type { LangyLinkRedis } from "./repositories/redis/redis.langy-resource-links.repository.ts";
export { LangyTurnAccessRedisRepository } from "./repositories/redis/redis.langy-turn-access.repository.ts";
export {
  LANGY_TURN_ACCESS_TTL_SECONDS,
  type LangyTurnAccess,
  LangyTurnAccessRepository,
} from "./repositories/langy-live-turn.repository.ts";
export { LangyTurnHandoffRedisRepository } from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
export type { LangyHandoffRedis } from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
export {
  LANGY_HANDOFF_TTL_SECONDS,
  type LangyTurnHandoff,
  LangyTurnHandoffRepository,
} from "./repositories/langy-live-turn.repository.ts";
export { LangyTokenBufferRedisRepository } from "./repositories/redis/redis.langy-token-buffer.repository.ts";
export {
  type LangyStreamRead,
  type LangyStreamRedis,
  type LangyTokenBufferConnection,
  LangyTokenBuffer,
} from "./repositories/langy-token-buffer.repository.ts";
export { LANGY_EMPTY_TURN_FALLBACK } from "./rules/langy-empty-turn.rules.ts";
export { LangyTurnSettlementWaiterService } from "./services/langy-turn-settlement-waiter.service.ts";
export { decideSyntheticTerminal } from "./rules/langy-turn-settlement.rules.ts";
export type {
  LangyTurnSettlementReader,
  OpenLangyTurnBuffer,
  TurnSettlement,
} from "./services/langy-turn-settlement-waiter.service.ts";

// --------------------------------------------------------------------------- The four public and
// internal REST doors.
export {
  createLangyTurnsRestApp,
  type LangyTurnsRestMembers,
} from "./transport/api-rest/langy-turns.api.ts";
export {
  createLangyUiActionsRestApp,
  LangyUiActionRestCatalog,
  type LangyUiActionsRestMembers,
} from "./transport/api-rest/langy-ui-actions.api.ts";
export {
  langyInternalMetrics,
  langyInternalRest,
  langyRelayFrameMetrics,
  langyRelayLiveBuffer,
  type LangyInternalMetrics,
  type LangyRelayFrameMetrics,
  type RelayTally,
} from "./transport/langy-internal.rest.ts";
export {
  resolveLangyRestActor,
  resolveLangyRestCaller,
  type LangyRestCaller,
  type LangyRestCeiling,
  type LangyRestCredentialMembers,
  type LangyRestCredentialReader,
} from "./transport/api-rest/langy-rest-credentials.api.ts";
export { LANGY_API_KEY_TURNS_FLAG } from "./rules/langy-rest-flags.rules.ts";
export { LangyAccessService, LANGY_RELEASE_FLAG } from "./services/langy-access.service.ts";
export {
  LangyActorSessionService,
  type LangyActorResolution,
  type LangyActorUserReader,
} from "./services/langy-actor-session.service.ts";
export {
  LangyKeyIdentityService,
  type LangyIdentityDenialReason,
  type LangyIdentityToken,
  type LangyKeyIdentity,
} from "./services/langy-key-identity.service.ts";

// The per-user daily cap on pull requests Langy may open on someone's behalf.
export {
  type GithubPrLimitResult,
  LANGY_GITHUB_PRS_PER_DAY,
  LangyGithubPrCounter,
  LangyGithubPrQuotaService,
} from "./services/langy-github-pr-quota.service.ts";
export {
  LANGY_DISPATCH_METRIC_NAME,
  OtelLangyWorkerMetricsAdapter,
} from "./services/langy-worker-metrics-otel.service.ts";
export {
  LANGY_BLOCKS_METRIC_NAME,
  LangyBlockOtelMetricsAdapter,
} from "./services/langy-block-metrics-otel.service.ts";

// ADR-129 local control: the developer's own folder, and the cards that wait
// for the developer. One runtime per process, two transports over it, and the
// worker's REST door onto both.
export {
  RedisLangyLocalControlRuntimeRepository as LangyLocalControlRuntimeAdapter,
  type LocalControlRuntime,
} from "./repositories/redis/redis.langy-local-control-runtime.repository.ts";
export {
  ControlRequestService,
  type ControlRequestKeyMinter,
  type ControlRequestProjects,
  type StoredControlRequest,
} from "./services/langy-local-control-request.service.ts";
export { LocalControlSessionCoreService } from "./services/langy-local-session.service.ts";
export type { LocalControlSessionCoreOptions } from "./services/langy-local-session.service.ts";
export type {
  ControlConversations,
  ControlCredentialReader,
  ControlEvents,
  ControlSkipGate,
  ControlTurnStarter,
  LangyLocalConversationTurns,
} from "./rules/langy-local-session-contract.rules.ts";
export {
  connectMessage,
  conversationTitle,
  conversationUrl,
  disconnectMessage,
  grantedPatterns,
} from "./rules/langy-local-session-text.rules.ts";
export { LocalCallDispatcherService } from "./services/langy-local-call-dispatcher.service.ts";
export { UserWaitService } from "./services/langy-local-user-wait.service.ts";
export type { UserWaitEvents } from "./rules/langy-local-user-wait-record.rules.ts";
export { LangyLocalPresenceRedisRepository } from "./repositories/redis/redis.langy-local-presence.repository.ts";
export { reconcileSkipPolicy, type SkipGate } from "./rules/langy-local-skip-policy.rules.ts";
export {
  SkipPermissionsService,
  type SkipPermissionsDecision,
  type SkipPermissionsProviderRow,
  type SkipPermissionsProviderRows,
} from "./services/langy-skip-permissions.service.ts";
export {
  createLangyLocalRestApp,
  type LangyCodeAccessPreferenceReader,
  type LangyGithubInstallationReader,
  type LangyLocalRestCommands,
  type LangyLocalRestMembers,
} from "./transport/api-rest/langy-local.api.ts";
export {
  createLangyLocalControlRestApp,
  type LangyLocalControlRestMembers,
} from "./transport/api-rest/langy-local-control.api.ts";
export {
  LocalControlLongPoll,
  type LocalControlLongPollOptions,
} from "./transport/api-rest/langy-local-control-long-poll.api.ts";
export {
  CONTROL_CONNECT_PATH,
  LocalControlGateway,
  type ControlGatewayOptions,
} from "./transport/api-ws/langy-local-control.api.ts";
