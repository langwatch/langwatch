export { langyProcessModule } from "./langy.module.ts";
export type { LangyDatabase } from "./repositories/prisma/langy-database.mapper.ts";
export type { LangyTurnTechnicalMembers } from "./services/langy-turn.service.ts";
export type { LangySessionKeyRevocation } from "./services/langy-session-key.service.ts";
export type {
  LangyConversationCommands,
  LangyConversationEventsReader,
  LangyConversationRuntime,
  OpenLangyRelay,
} from "./services/langy.service.ts";
export type { LangyTurnAdmissionCapability } from "@langwatch/langy-contract";
export type { SetupSkillId } from "./services/setup-skills.service.ts";
export { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";
export { langyEgressTrpcTransport, langyTrpcTransport } from "./transport/langy.trpc.ts";
// The agent-to-page UI-action channel. Moved here whole from the application
// that used to hold it; the one thing it could not bring is the workbench's
// action manifest, which arrives as {@link LangyUiActionCatalog}.
export type {
  UiActionBackendRunner,
  UiActionCompletion,
  UiActionConversations,
  UiActionOutcome,
} from "./services/langy-ui-action.service.ts";
export type {
  UiActionBlockingRedis,
  UiActionRedis,
} from "./repositories/redis/redis.langy-ui-action.repository.ts";

// Application-facing Langy orchestration primitives. These are deliberately
// exported from the package root so the application never couples itself to
// the feature's private repository/service layout.
export type { LangyToolFrame } from "./rules/langy-cli-envelope.rules.ts";
export type { LangyConversationProcessingEvent } from "./eventing/langy-conversation-state.projection.ts";
export { LANGY_AGENT_DISPATCH_TIMEOUT_MS } from "./eventing/langy-conversation-process.schemas.ts";
export {
  AGENT_DISPATCH_TIMEOUT_MS,
  HttpLangyWorkerChannel,
} from "./channels/http/http.langy-worker.channel.ts";
export type {
  LangyDispatchOutcome,
  LangyWorkerChannelConfig,
  LangyWorkerHttpConfig,
} from "./channels/http/http.langy-worker.channel.ts";
export { UnavailableLangyWorkerChannel } from "./channels/unavailable.langy-worker.channel.ts";
export { LangyWorkerMetrics, LangyWorker } from "./channels/langy-worker.channel.ts";
export type {
  LangyWorkerCancelInput,
  LangyWorkerDispatchInput,
  LangyWorkerProbeInput,
  LangyWorkerWarmInput,
} from "./channels/langy-worker.channel.ts";
export type { LangyConversationProcessingPipelineDeps } from "./eventing/langy-conversation.pipeline.ts";
export {
  EventingLangyConversationAdapter,
  type EventingLangyConversationAdapterOptions,
  type RedisLangyConversationRuntimeRepository,
} from "./eventing/langy-conversation-runtime.pipeline.ts";
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
export type { LangyRepositories } from "./repositories/langy-repositories.registry.ts";
export type {
  LangyAnalyticsClickHouseClientResolver,
  LangyAnalyticsClickHouseWriteClient,
} from "./repositories/clickhouse/clickhouse.langy-analytics-event.repository.ts";
export type { LangyAnalyticsEventRecord } from "./repositories/langy-analytics-event.repository.ts";
export type { LangyIntentEffects } from "./eventing/langy-conversation.intent.ts";
export type { LangyTitleGenerator } from "./services/langy-title-generator.service.ts";
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
export type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./eventing/langy-conversation-process.schemas.ts";
export type { LangyFrameDedupRedis } from "./repositories/redis/redis.langy-frame-dedup.repository.ts";
export type { LangyLinkRedis } from "./repositories/redis/redis.langy-resource-links.repository.ts";
export type { LangyTurnAccess } from "./repositories/langy-live-turn.repository.ts";
export type { LangyHandoffRedis } from "./repositories/redis/redis.langy-turn-handoff.repository.ts";
export type { LangyTurnHandoff } from "./repositories/langy-live-turn.repository.ts";
export type {
  LangyStreamRead,
  LangyStreamRedis,
  LangyTokenBufferConnection,
} from "./repositories/langy-token-buffer.repository.ts";

// --------------------------------------------------------------------------- The four public and
// internal REST doors.
export { langyTurnsRest } from "./transport/langy-turns.rest.ts";
export { langyUiActionsRest } from "./transport/langy-ui-actions.rest.ts";
export { langyInternalRest } from "./transport/langy-internal.rest.ts";
export type { RelayTally } from "@langwatch/langy-contract";
export type {
  LangyInternalMetrics,
  LangyRelayFrameMetrics,
} from "./services/langy-internal.service.ts";
export type {
  LangyActorResolution,
  LangyActorUserReader,
} from "./services/langy-actor-session.service.ts";
export type {
  LangyIdentityDenialReason,
  LangyIdentityToken,
  LangyKeyIdentity,
} from "./services/langy-key-identity.service.ts";

// The per-user daily cap on pull requests Langy may open on someone's behalf.
export type { GithubPrLimitResult } from "./services/langy-github-pr-quota.service.ts";

// ADR-129 local control: the developer's own folder, and the cards that wait
// for the developer. One runtime per process, two transports over it, and the
// worker's REST door onto both.
export type { LocalControlRuntime } from "./services/langy-local-control-runtime.service.ts";
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
export { langyLocalRest } from "./transport/langy-local.rest.ts";
export { langyLocalControlRest } from "./transport/langy-local-control.rest.ts";
export { langyLocalControlConnectRest } from "./transport/langy-local-control-connect.rest.ts";
export {
  CONTROL_CONNECT_PATH,
  createLangyLocalControlWebSocketProtocol,
} from "./transport/langy-local-control.ws.ts";
