export {
  PostgresLangyAdapter,
  type LangyCredentialComposition,
  type LangyServiceCompositionOptions,
  LangyEventingPorts,
  LangyTrustedMessagePort,
  type PostgresLangyAdapterOptions,
} from "./adapters/langy.langy.adapter";
export type { LangyDatabase } from "./repositories/prisma/langy-database.port";
export type { LangyTurnTechnicalPorts } from "./services/langy-turn.service";
export {
  LANGY_CANDIDATE_PERMISSIONS,
  LangySessionKeyService,
} from "./services/langy-session-key.service";
export { LangySessionKeyMetricsPort } from "./ports/langy-session-key-metrics.port";
export { LangySessionKeyReapService } from "./services/langy-session-key-reap.service";
export { LangySessionKeyReapRepository } from "./repositories/langy-session-key-reap.repository";
export {
  OtelLangySessionKeyMetricsAdapter,
  LANGY_SESSION_KEYS_METRIC_NAME,
} from "./adapters/otel.langy-session-key-metrics.adapter";
export {
  PostgresLangySessionKeyReapAdapter,
  type LangySessionKeyReapDatabase,
} from "./adapters/postgres.langy-session-key-reap.adapter";
export type { LangySessionKeyRevocation } from "./services/langy-session-key.service";
export { ADOPTABLE_CONVERSATION_ID } from "./services/langy.service";
export type {
  LangyConversationCommands,
  LangyConversationEventsReader,
  LangyConversationRuntime,
  LangyRelayCompositionOptions,
} from "./services/langy.service";
export type { LangyTurnAdmissionCapability } from "@langwatch/langy-contract";
export {
  LangyApp,
  LangySessionRequiredError,
  type LangyAppDependencies,
  type LangyBroadcast,
  type LangyEgressState,
  type LangyRedis,
  type LangyTurnRequest,
  type LangyTurnStream,
} from "./app/langy.app";
export {
  LangyTrpcApi,
  type LangyTrpcContext,
  type LangyTrpcPorts,
  type LangyUiActionPort,
} from "./transport/api-trpc/langy.api";
export {
  LangyEgressTrpcApi,
  type LangyEgressTrpcContext,
  type LangyEgressTrpcPorts,
} from "./transport/api-trpc/langy-egress.api";
// The setup-skill catalogue and the door onto it. Langy's because the BODIES
// are: they are generated from the compiled skills the Langy image ships, so
// the prompt a customer copies and the skill Langy runs cannot disagree.
export {
  SetupSkillsTrpcApi,
  type SetupSkillsTrpcContext,
} from "./transport/api-trpc/setup-skills.api";
export { isSetupSkillId, setupSkillBody, type SetupSkillId } from "./services/setup-skills.service";
// The agent-to-page UI-action channel. Moved here whole from the application
// that used to hold it; the one thing it could not bring is the workbench's
// action manifest, which arrives as {@link LangyUiActionCatalogPort}.
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
} from "./services/langy-ui-action.service";
export {
  LangyUiActionCatalogPort,
  type LangyUiActionDefinition,
} from "./ports/langy-ui-action-catalog.port";

// Application-facing Langy orchestration primitives. These are deliberately
// exported from the package root so the application never couples itself to
// the feature's private repository/service layout.
export { LangyCliEnvelopeService } from "./services/langy-cli-envelope.service";
export type { LangyToolFrame } from "./services/langy-cli-envelope.service";
export { LangyFinalPartsService } from "./services/langy-final-parts.service";
export {
  AGENT_CHAT_TIMEOUT_MS,
  LangyTurnErrors,
  LangyWorkerStoppedError,
} from "./adapters/langy.turn-errors.adapter";
export type { LangyConversationProcessingEvent } from "./adapters/eventing.langy.adapter";
export {
  computeFrameMac,
  mintRunToken,
  newFrameNonce,
  signFrame,
  verifyFrame,
} from "./ports/langy-frame-auth.port";
export { LANGY_AGENT_DISPATCH_TIMEOUT_MS } from "./ports/langy-effect.port";
export {
  AGENT_DISPATCH_TIMEOUT_MS,
  createLangyWorkerPort,
} from "./adapters/langy-worker-http.adapter";
export type {
  LangyDispatchOutcome,
  LangyWorkerAdapterConfig,
  LangyWorkerHttpConfig,
} from "./adapters/langy-worker-http.adapter";
export { NullLangyWorkerMetricsAdapter } from "./adapters/null-langy-worker-metrics.adapter";
export { UnavailableLangyWorkerAdapter } from "./adapters/unavailable-langy-worker.adapter";
export {
  LANGY_UI_ACTIONS_FLAG,
  LangyUiActionSurfacePort,
  LangyWorkerMetricsPort,
  LangyWorkerPort,
} from "./ports/langy-turn-runtime.port";
export type {
  LangyWorkerCancelInput,
  LangyWorkerDispatchInput,
  LangyWorkerProbeInput,
  LangyWorkerWarmInput,
} from "./ports/langy-turn-runtime.port";
export { FeatureFlagLangyUiActionSurfaceAdapter } from "./adapters/feature-flag.langy-ui-action-surface.adapter";
export { createLangyConversationProcessingPipeline } from "./adapters/eventing.langy-conversation.adapter";
export type { LangyConversationProcessingPipelineDeps } from "./adapters/eventing.langy-conversation.adapter";
export {
  EventingLangyConversationAdapter,
  type EventingLangyConversationAdapterOptions,
  type LangyConversationRuntimeCommands,
} from "./adapters/eventing.langy-conversation-runtime.adapter";
export { createLangyConversationProducerPipeline } from "./adapters/langy-conversation-producer.adapter";
export {
  EventingLangyMaintenanceAdapter,
  type LangyMaintenancePipelineDeps,
} from "./adapters/eventing.langy-maintenance.adapter";
export {
  LANGY_SESSION_KEY_REAP_INTERVAL_MS,
  LANGY_SESSION_KEY_REAP_PROCESS_NAME,
  langySessionKeyReapWake,
  type LangySessionKeyReapState,
} from "./processes/langy-session-key-reap.process";
export {
  runLangySessionKeyReap,
  type LangySessionKeyReapDeps,
} from "./intents/langy-session-key-reap.intent";
export type { LangyAnalyticsEventProjectionRecord } from "./adapters/eventing.langy-projections-index.adapter";
export {
  LangyAnalyticsEventStorageAdapter,
  NullLangyAnalyticsEventSinkAdapter,
} from "./adapters/langy-analytics-event-storage.adapter";
export {
  ClickHouseLangyAnalyticsEventAdapter,
  type LangyAnalyticsClickHouseClientResolver,
  type LangyAnalyticsClickHouseWriteClient,
} from "./adapters/clickhouse.langy-analytics-event.adapter";
export { LangyAnalyticsEventSinkPort } from "./ports/langy-analytics-event-sink.port";
export type { LangyAnalyticsEventRecord } from "./ports/langy-analytics-event-sink.port";
export type { LangyEffectPorts } from "./ports/langy-effect.port";
export type { LangyTitleGenerator } from "./ports/langy-effect.port";
export { LangyTitleModelPort } from "./ports/langy-title-model.port";
export {
  LANGY_TITLE_FEATURE_KEY,
  LangyTitleGeneratorService,
  type LangyTitleGeneratorDeps,
} from "./services/langy-title-generator.service";
export {
  LangyEffectPortsAdapter,
  type CreateLangyEffectPortsOptions,
} from "./adapters/langy-effect.adapter";
export {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
  LANGY_HEARTBEAT_GRACE_MS,
} from "./subscribers/langy-conversation.subscriber";
export type {
  AgentTurnLivenessSubscriberDeps,
  LangyConversationFreshnessReader,
  LangyConversationFreshnessRecord,
  LangyConversationLivenessReader,
  LangyConversationLivenessRecord,
  LangyBroadcastPort,
  LangyConversationUpdateBroadcastSubscriberDeps,
  LangyFailTurnCommandPort,
} from "./subscribers/langy-conversation.subscriber";
export type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./ports/langy-conversation-process.port";
export { LangyFrameDedupStore } from "./streaming/langy-frame-dedup";
export type { LangyFrameDedup, LangyFrameDedupRedis } from "./streaming/langy-frame-dedup";
export { LangyResourceLinksStore } from "./streaming/langy-resource-links";
export type { LangyLinkRedis, LangyResourceLinkStore } from "./streaming/langy-resource-links";
export { LangyTurnAccessStore, LANGY_TURN_ACCESS_TTL_SECONDS } from "./streaming/langy-turn-access";
export type { LangyTurnAccess } from "./streaming/langy-turn-access";
export { LangyTurnHandoffStore, LANGY_HANDOFF_TTL_SECONDS } from "./streaming/langy-turn-handoff";
export type { LangyHandoffRedis, LangyTurnHandoff } from "./streaming/langy-turn-handoff";
export { LangyTokenBuffer } from "./streaming/langy-token-buffer";
export type { LangyStreamEntry } from "./streaming/langy-token-buffer";
export {
  abortableDelay,
  awaitTurnSettlement,
  settlementFromEvents,
} from "./streaming/langy-turn-settlement-waiter";
export { decideSyntheticTerminal } from "./streaming/langy-turn-settlement";
export type {
  LangyTurnSettlementReader,
  LangyTurnSettlementRedis,
  TurnSettlement,
} from "./streaming/langy-turn-settlement-waiter";

// ---------------------------------------------------------------------------
// The four public and internal REST doors.
//
// The turn surface and the UI-action surface share one credential chain
// (`langy-rest.credentials`), because the ORDER of its refusals — credential,
// dark 404, ceiling, identity — is the contract rather than an implementation
// detail, and two copies of it would drift into two different leaks.
// ---------------------------------------------------------------------------
export {
  createLangyTurnsRestApp,
  type LangyTurnsRestPorts,
} from "./transport/api-rest/langy-turns.api";
export {
  createLangyUiActionsRestApp,
  LangyUiActionRestCatalogPort,
  type LangyUiActionsRestPorts,
} from "./transport/api-rest/langy-ui-actions.api";
export {
  createLangyInternalRestApp,
  type LangyInternalMetricsPort,
  type LangyInternalRestPorts,
} from "./transport/api-rest/langy-internal.api";
export {
  createLangyRelayRestApp,
  type LangyRelayRestPorts,
  type RelayTally,
} from "./transport/api-rest/langy-relay.api";
export {
  resolveLangyRestActor,
  resolveLangyRestCaller,
  type LangyRestCaller,
  type LangyRestCeilingPort,
  type LangyRestCredentialPorts,
  type LangyRestCredentialReader,
} from "./transport/api-rest/langy-rest.credentials";
export { LANGY_API_KEY_TURNS_FLAG } from "./transport/api-rest/langy-rest.flags";
export { hasLangyAccess, LANGY_RELEASE_FLAG } from "./services/langy-access.service";
export {
  resolveLangyActorSession,
  type LangyActorResolution,
  type LangyActorUserReader,
} from "./services/langy-actor-session.service";
export {
  resolveLangyKeyIdentity,
  type LangyIdentityDenialReason,
  type LangyIdentityToken,
  type LangyKeyIdentity,
} from "./services/langy-key-identity.service";

// The per-user daily cap on pull requests Langy may open on someone's behalf.
export {
  getLangyGithubPrUsage,
  type GithubPrLimitResult,
  LANGY_GITHUB_PRS_PER_DAY,
  LangyGithubPrCounterPort,
  recordExtraLangyGithubPrs,
  recordLangyGithubPr,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "./services/langy-github-pr-quota.service";
export {
  LANGY_DISPATCH_METRIC_NAME,
  OtelLangyWorkerMetricsAdapter,
} from "./adapters/otel.langy-worker-metrics.adapter";
export {
  LANGY_BLOCKS_METRIC_NAME,
  createOtelLangyBlockCounter,
} from "./adapters/otel.langy-block-metrics.adapter";
