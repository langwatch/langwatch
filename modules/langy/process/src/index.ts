export {
  PostgresLangyAdapter,
  type LangyCredentialComposition,
  type LangyServiceCompositionOptions,
  LangyEventingMembers,
  LangyTrustedMessage,
  type PostgresLangyAdapterOptions,
} from "./services/langy-postgres.service.ts";
export { langyServer } from "./langy.server.ts";
export { type LangyNavigateProject } from "./app/langy.members.ts";
export type { LangyNavigateResourceLocator } from "./app/langy.members.ts";
export type { LangyNavigateResourceKind } from "./rules/langy-navigate-resources.rules.ts";
export type { LangyRelayCompositionOptions } from "./services/langy-postgres.service.ts";
export type { LangyDatabase } from "./repositories/prisma/langy-database.mapper.ts";
export type { LangyTurnTechnicalMembers } from "./services/langy-turn.service.ts";
export { type LangySessionKeyMetrics } from "./app/langy.members.ts";
export {
  OtelLangySessionKeyMetricsAdapter,
  LANGY_SESSION_KEYS_METRIC_NAME,
} from "./services/langy-session-key-metrics-otel.service.ts";
export type { PrismaLangySessionKeyReapDatabase } from "./repositories/prisma/prisma.langy-session-key-reap.repository.ts";
// The seam for the two rows above: a composing worker calls this instead of naming either
// class (private-runtime-export drive, dev/docs/plans/private-runtime-export-drive.md §3d).
// The raw exports stay until every importer is rewired onto the seam.
export { createLangySessionKeyReap } from "./langy.server.ts";
export type { LangySessionKeyRevocation } from "./services/langy-session-key.service.ts";
export type {
  LangyConversationCommands,
  LangyConversationEventsReader,
  LangyConversationRuntime,
  OpenLangyRelay,
} from "./services/langy.service.ts";
export type { LangyTurnAdmissionCapability } from "@langwatch/langy-contract";
export type { LangyEgressState, LangyRedis, LangyTurnRequest } from "./app/langy.app.ts";
// `langy.*` and `langyEgress.*` are not exported: they still name the deleted
// legacy builder, so nothing may reach them until each is converted to the
// declared `defineTrpcRouter` shape. `setupSkills.*` is converted and exported
// below.
export type { SetupSkillId } from "./services/setup-skills.service.ts";
export { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";
// The agent-to-page UI-action channel. Moved here whole from the application
// that used to hold it; the one thing it could not bring is the workbench's
// action manifest, which arrives as {@link LangyUiActionCatalog}.
export type {
  UiActionBackendRunner,
  UiActionBlockingRedis,
  UiActionCompletion,
  UiActionConversations,
  UiActionOutcome,
  UiActionRedis,
} from "./services/langy-ui-action.service.ts";
export {
  type LangyUiActionBackendMode,
  type LangyUiActionCatalog,
  type LangyUiActionDefinition,
} from "./app/langy.members.ts";
export {
  type LangyBackendActor,
  type LangyBackendRunResult,
  type LangyBackendSaveResult,
  type LangyBackendStateRead,
  type LangyUiActionBackend,
} from "./app/langy.members.ts";

// Application-facing Langy orchestration primitives. These are deliberately
// exported from the package root so the application never couples itself to
// the feature's private repository/service layout.
export type { LangyToolFrame } from "./services/langy-cli-envelope.service.ts";
export type { LangyConversationProcessingEvent } from "./eventing/langy-conversation-state.projection.ts";
export {
  computeFrameMac,
  mintRunToken,
  newFrameNonce,
  signFrame,
  verifyFrame,
} from "./rules/langy-frame-auth.rules.ts";
export { LANGY_AGENT_DISPATCH_TIMEOUT_MS } from "./eventing/langy-conversation-process.schemas.ts";
export {
  AGENT_DISPATCH_TIMEOUT_MS,
  HttpLangyWorkerAdapter,
} from "./channels/http/http.langy-worker.channel.ts";
export type {
  LangyDispatchOutcome,
  LangyWorkerAdapterConfig,
  LangyWorkerHttpConfig,
} from "./channels/http/http.langy-worker.channel.ts";
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
export {
  EventingLangyMaintenanceAdapter,
  type LangyMaintenancePipelineDeps,
} from "./services/langy-maintenance.service.ts";
// The seam for the conversation-runtime's five process-graph rows above: a composing worker
// calls these instead of naming the classes directly (private-runtime-export drive,
// dev/docs/plans/private-runtime-export-drive.md §3d). The raw exports stay until every
// importer is rewired onto the seam.
export {
  createLangyAnalyticsEventClickHouseSink,
  createEventingLangyConversationAdapter,
  createLangyTokenBufferRedisRepository,
  createLangyTurnHandoffRedisRepository,
  createLangyTitleGenerator,
} from "./langy.server.ts";
export {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapWake,
  type LangySessionKeyReapState,
} from "./eventing/langy-session-key-reap.process.ts";
export {
  runLangySessionKeyReap,
  type LangySessionKeyReapDeps,
} from "./eventing/langy-session-key-reap.intent.ts";
export type { LangyAnalyticsEventProjectionRecord } from "./eventing/langy-analytics-event.projection.ts";
export { LangyAnalyticsEventStorageAdapter } from "./services/langy-analytics-event-storage.service.ts";
export type { LangyRepositories } from "./repositories/langy-repositories.registry.ts";
export type {
  LangyAnalyticsClickHouseClientResolver,
  LangyAnalyticsClickHouseWriteClient,
} from "./repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
export type { LangyAnalyticsEventRecord } from "./repositories/langy-analytics-event.repository.ts";
export type { LangyEffectMembers } from "./app/langy.members.ts";
export type { LangyTitleGenerator } from "./app/langy.members.ts";
export type { LangyTitleModelResolver } from "./app/langy.members.ts";
export {
  LANGY_TITLE_FEATURE_KEY,
  LangyTitleGeneratorService,
  type LangyTitleGeneratorDeps,
} from "./services/langy-title-generator.service.ts";
export type { CreateLangyEffectRepositoryOptions } from "./repositories/redis/redis.langy-effect.repository.ts";
export {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
  LANGY_HEARTBEAT_GRACE_MS,
} from "./eventing/langy-conversation.subscriber.ts";
export type {
  AgentTurnLivenessSubscriberDeps,
  LangyConversationFreshnessReader,
  LangyConversationFreshnessRecord,
  LangyConversationLivenessReader,
  LangyConversationLivenessRecord,
  LangyConversationUpdateChannel,
  LangyConversationUpdateBroadcastSubscriberDeps,
  LangyFailTurnCommand,
} from "./eventing/langy-conversation.subscriber.ts";
export type { LangyGenerateTitleIntent, LangyWorkerDispatchIntent } from "./app/langy.members.ts";
export type { LangyFrameDedupRedis } from "./repositories/redis/redis.langy-frame-dedup.repository.ts";
export type { LangyLinkRedis } from "./repositories/redis/redis.langy-resource-links.repository.ts";
export type { LangyTurnAccess } from "./repositories/langy-live-turn.repository.ts";
export { LangyTurnHandoffRedisRepository } from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
export type { LangyHandoffRedis } from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
export type { LangyTurnHandoff } from "./repositories/langy-live-turn.repository.ts";
export { LangyTokenBufferRedisRepository } from "./repositories/redis/redis.langy-token-buffer.repository.ts";
export type {
  LangyStreamRead,
  LangyStreamRedis,
  LangyTokenBufferConnection,
} from "./repositories/langy-token-buffer.repository.ts";
export type {
  LangyTurnSettlementReader,
  OpenLangyTurnBuffer,
  TurnSettlement,
} from "./services/langy-turn-settlement-waiter.service.ts";
export { LangyTurnsBoundsService } from "./services/langy-turns-bounds.service.ts";

// --------------------------------------------------------------------------- The four public and
// internal REST doors.
export {
  langyTurnsMembers,
  langyTurnsRest,
  type LangyTurnsRestMembers,
} from "./transport/langy-turns.rest.ts";
export {
  langyUiActionsRest,
  langyUiActionsRestMembers,
  LangyUiActionRestCatalog,
  type LangyUiActionsRestMembers,
} from "./transport/langy-ui-actions.rest.ts";
export { langyInternalRest } from "./transport/langy-internal.rest.ts";
export type { RelayTally } from "@langwatch/langy-contract";
export type {
  LangyInternalMetrics,
  LangyRelayFrameMetrics,
} from "./services/langy-internal.service.ts";
export {
  resolveLangyRestActor,
  resolveLangyRestCaller,
  type LangyRestCaller,
  type LangyRestCeiling,
  type LangyRestCredentialMembers,
  type LangyRestCredentialReader,
} from "./transport/langy-rest-credentials.ts";
export type {
  LangyActorResolution,
  LangyActorUserReader,
} from "./services/langy-actor-session.service.ts";
export type {
  LangyIdentityDenialReason,
  LangyIdentityToken,
  LangyKeyIdentity,
} from "./services/langy-key-identity.service.ts";
export {
  LangyRestCallerService,
  type LangyRestCallerMembers,
} from "./services/langy-rest-caller.service.ts";

// The per-user daily cap on pull requests Langy may open on someone's behalf.
export type { GithubPrLimitResult } from "./services/langy-github-pr-quota.service.ts";
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
export type { LocalControlRuntime } from "./repositories/redis/redis.langy-local-control-runtime.repository.ts";
export type {
  ControlRequestKeyMinter,
  ControlRequestProjects,
  StoredControlRequest,
} from "./services/langy-local-control-request.service.ts";
export type { LocalControlSessionCoreOptions } from "./services/langy-local-session.service.ts";
export type {
  ControlConversations,
  ControlCredentialReader,
  ControlEvents,
  ControlSkipGate,
  ControlTurnStarter,
  LangyLocalConversationTurns,
} from "./rules/langy-local-session-contract.rules.ts";
export type { UserWaitEvents } from "./rules/langy-local-user-wait-record.rules.ts";
export type { SkipGate } from "./rules/langy-local-skip-policy.rules.ts";
export type {
  SkipPermissionsDecision,
  SkipPermissionsProviderRow,
  SkipPermissionsProviderRows,
} from "./services/langy-skip-permissions.service.ts";
export {
  langyLocalRest,
  langyLocalRestMembers,
  type LangyLocalRestCommands,
  type LangyLocalRestMembers,
} from "./transport/langy-local.rest.ts";
export {
  langyLocalControlRest,
  langyLocalControlRestMembers,
  type LangyLocalControlRestMembers,
} from "./transport/langy-local-control.rest.ts";
export {
  LocalControlLongPoll,
  type LocalControlLongPollOptions,
} from "./transport/langy-local-control-long-poll.rest.ts";
export {
  CONTROL_CONNECT_PATH,
  LocalControlGateway,
  type ControlGatewayOptions,
} from "./transport/langy-local-control.ws.ts";
