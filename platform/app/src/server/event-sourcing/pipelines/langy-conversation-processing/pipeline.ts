import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { LangyTitleGenerator } from "~/server/app-layer/langy/langy-title-generation.service";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import type { LangyTurnAdmissionRepository } from "~/server/app-layer/langy/repositories/langy-turn-admission.repository";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
} from "~/server/app-layer/langy/subscribers";
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import { createLangyConversationReader } from "./conversationReader.adapter";
import { createLangySelfCommandPorts } from "./selfCommands.adapter";
import {
  buildLangyProcessEventView,
  createLangyEffectPorts,
  handleAgentResponded,
  handleAgentResponseFailed,
  handleAgentTurnAccepted,
  handleArchived,
  handleHandoffConsumed,
  handleHandoffPending,
  handleMetadataUpdated,
  handleTitleGenerated,
  INITIAL_LANGY_PROCESS_STATE,
  LANGY_CONVERSATION_PROCESS_NAME,
  LANGY_OUTBOX_LEASE_DURATION_MS,
  LANGY_PROCESS_INTENT_TYPES,
  langyGenerateTitleIntentSchema,
  langyWorkerDispatchIntentSchema,
  type LangyConversationProcessState,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/process-manager";
import {
  ArchiveConversationCommand,
  ConsumeTurnHandoffCommand,
  RecordMessageCommand,
  AcceptAgentTurnCommand,
  CreateConversationCommand,
  FailAgentResponseCommand,
  FailToolCallCommand,
  ForkConversationCommand,
  GenerateConversationTitleCommand,
  ImportMessageCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  RecordTurnHandoffCommand,
  SucceedToolCallCommand,
  UpdateConversationMetadataCommand,
  UpdatePlanCommand,
} from "./commands";
import { LangyMessageOperationalMapProjection } from "./projections/langyMessageOperational.mapProjection";
import {
  type LangyAnalyticsEventProjectionRecord,
  LangyAnalyticsEventMapProjection,
} from "./projections/langyAnalyticsEvent.mapProjection";
import { LangyConversationStateFoldProjection } from "./projections/langyConversationState.foldProjection";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy";
import { LangyConversationTurnFoldProjection } from "./projections/langyConversationTurn.foldProjection";
import type { LangyConversationProcessingEvent } from "./schemas/events";

/** Short aliases so the process topology below reads as one machine. */
const EVENT_TYPES = LANGY_CONVERSATION_EVENT_TYPES;

/**
 * The intent names are the pre-existing dotted types rather than the short
 * camelCase newer processes use: the name IS the persisted `intentType`, so
 * renaming one would leave any in-flight outbox row without a handler, to
 * retry-churn until it died. They can be shortened once the table is drained.
 */
const INTENTS = LANGY_PROCESS_INTENT_TYPES;

/**
 * ADR-082 Rule 1 — nothing here is a value the builder registers. The three
 * live subscribers and the process manager's effect ports are constructed in
 * this file, from the stores, clients and ports below, so the pipeline states
 * its own topology rather than being handed one.
 */
export interface LangyConversationProcessingPipelineDeps {
  langyConversationProjectionStore: StateProjectionStore<LangyConversationStateData>;
  /**
   * Per-turn render document (langyConversationTurn): a second fold over the same
   * stream, keyed by `${conversationId}:${turnId}`. Folds one turn into its final
   * state (status, answer parts, tool-call lifecycle) for one-read rendering.
   */
  langyConversationTurnProjectionStore: StateProjectionStore<LangyConversationTurnData>;
  langyMessageProjectionStore: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free event-grain ClickHouse analytics; never an operational read. */
  langyAnalyticsEventProjectionStore: AppendStore<LangyAnalyticsEventProjectionRecord>;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  langyTurnAdmissionRepository: LangyTurnAdmissionRepository;
  /** Ephemeral Redis heartbeat and stream tail (ADR-046). */
  tokenBuffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
  handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
  worker: Pick<LangyWorkerPort, "dispatch">;
  titleGenerator: LangyTitleGenerator;
  broadcast: Pick<BroadcastService, "broadcastToTenant">;
  /** Session-scoped API key lifecycle for a dispatched turn. */
  mintSessionKey: (args: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
  revokeSessionKey: (args: {
    apiKeyId: string;
    projectId: string;
  }) => Promise<void>;
  /** ADR-082 §5 — identity-keyed dispatch into this pipeline's own commands. */
  commands: CommandBus;
}

/**
 * Creates the langy-conversation-processing pipeline definition (ADR-046).
 *
 * Aggregate: `langy_conversation` (aggregateId = conversationId,
 * TenantId = projectId). A Langy conversation is a projection of its event
 * stream; Postgres is its low-latency operational read model.
 *
 * Operational Projection: langyConversationState
 * - Conversation-level spine (owner, title, status, counts, timestamps,
 *   sharing). Stored directly in Postgres with no Redis projection cache.
 *
 * Operational Projection: langyConversationTurn
 * - Per-turn render document — a SECOND fold over the same stream, keyed by
 *   `${conversationId}:${turnId}` (the fold's custom key). Folds one turn into
 *   its final state (status, answer parts, tool-call lifecycle). Stored in Postgres.
 *
 * Map Projection: langyMessageOperational
 * - Per-message rows for `message_recorded` (user) and `agent_responded`
 *   (assistant), stored in Postgres.
 *
 * Commands (write surface):
 * - createConversation: explicit creation -> conversation_started
 * - recordMessage: append a message -> message_recorded
 * - acceptAgentTurn: durable turn admission -> agent_turn_accepted
 * - recordAgentResponse: streamed answer completes -> agent_responded
 * - archiveConversation: soft-delete -> conversation_archived
 * - updateConversationMetadata: rename/share -> conversation_metadata_updated
 *
 * The response-lifecycle events (tool_call_*, agent_response_failed) are defined
 * with fold handlers dispatched by the agent during a response.
 *
 * Status/progress are EPHEMERAL signals (ADR-046): NOT commands and NOT durable
 * events — they are published to a Redis buffer via LangyEphemeralPublisher
 * (./ephemeral.ts), never through this pipeline. PR3 wires that transport.
 */
export function createLangyConversationProcessingPipeline(
  deps: LangyConversationProcessingPipelineDeps,
) {
  const conversations = createLangyConversationReader(
    deps.langyConversationProjectionStore,
  );
  const selfCommands = createLangySelfCommandPorts(deps.commands);
  const effects = createLangyEffectPorts({
    handoffStore: deps.handoffStore,
    worker: deps.worker,
    mintSessionKey: deps.mintSessionKey,
    revokeSessionKey: deps.revokeSessionKey,
    titleGenerator: deps.titleGenerator,
    saveTitle: selfCommands.saveTitle,
    failTurn: selfCommands.failTurn,
    markError: (args) => deps.tokenBuffer.markError(args),
  });

  return definePipeline<LangyConversationProcessingEvent>()
    .withName("langy_conversation_processing")
    .withAggregateType("langy_conversation")
    .withProjection(
      "langyConversationState",
      new LangyConversationStateFoldProjection({
        store: deps.langyConversationProjectionStore,
      }),
    )
    .withProjection(
      "langyConversationTurn",
      new LangyConversationTurnFoldProjection({
        store: deps.langyConversationTurnProjectionStore,
      }),
    )
    .withMapProjection(
      "langyMessageOperational",
      new LangyMessageOperationalMapProjection({
        store: deps.langyMessageProjectionStore,
      }),
    )
    .withMapProjection(
      "langyAnalyticsEvent",
      new LangyAnalyticsEventMapProjection({
        store: deps.langyAnalyticsEventProjectionStore,
      }),
    )
    // Live consumers — independent of projection state and of replay.
    .withEventSubscriber(
      "agentTurnLiveness",
      createAgentTurnLivenessSubscriber({
        buffer: deps.tokenBuffer,
        conversations,
        failTurn: selfCommands.failTurn,
        worker: deps.worker,
        handoffStore: deps.handoffStore,
      }),
    )
    .withEventSubscriber(
      "langyConversationUpdateBroadcast",
      createLangyConversationUpdateBroadcastSubscriber({
        broadcast: deps.broadcast,
        conversations,
      }),
    )
    .withEventSubscriber(
      "langyTurnAdmissionLifecycle",
      createLangyTurnAdmissionLifecycleSubscriber({
        admissions: deps.langyTurnAdmissionRepository,
      }),
    )
    // ADR-052: the whole `langyConversation` topology — state, intents, the
    // content boundary, every event decision and the outbox lease.
    .withProcessManager(LANGY_CONVERSATION_PROCESS_NAME, (pm) =>
      pm
        .state<LangyConversationProcessState>(INITIAL_LANGY_PROCESS_STATE)
        .intent(
          INTENTS.WORKER_DISPATCH,
          langyWorkerDispatchIntentSchema,
          (intent, { projectId }) =>
            effects.workerDispatch.dispatchTurn({ ...intent, projectId }),
        )
        .intent(
          INTENTS.GENERATE_TITLE,
          langyGenerateTitleIntentSchema,
          (intent, { projectId }) =>
            effects.titleGeneration.generateTitle({ ...intent, projectId }),
        )
        .toPayload(buildLangyProcessEventView)
        .on(EVENT_TYPES.AGENT_TURN_ACCEPTED, handleAgentTurnAccepted)
        .on(EVENT_TYPES.AGENT_RESPONDED, handleAgentResponded)
        .on(EVENT_TYPES.AGENT_RESPONSE_FAILED, handleAgentResponseFailed)
        .on(EVENT_TYPES.ARCHIVED, handleArchived)
        .on(EVENT_TYPES.METADATA_UPDATED, handleMetadataUpdated)
        .on(EVENT_TYPES.TITLE_GENERATED, handleTitleGenerated)
        .on(EVENT_TYPES.CONVERSATION_HANDOFF_PENDING, handleHandoffPending)
        .on(EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED, handleHandoffConsumed)
        // Conversation-level and turn-progress activity with no process
        // decision to make. Tool and plan events land here — they only ever
        // mattered to the liveness window, which the heartbeat-aware
        // subscriber owns.
        .ignores(
          EVENT_TYPES.CONVERSATION_STARTED,
          EVENT_TYPES.CONVERSATION_FORKED,
          EVENT_TYPES.MESSAGE_RECORDED,
          EVENT_TYPES.MESSAGE_IMPORTED,
          EVENT_TYPES.TOOL_CALL_INITIATED,
          EVENT_TYPES.TOOL_CALL_SUCCEEDED,
          EVENT_TYPES.TOOL_CALL_FAILED,
          EVENT_TYPES.PLAN_UPDATED,
        )
        // The lease MUST outlive the slowest accepted dispatch, or a healthy
        // long-running turn loses its lease mid-flight and a second instance
        // re-delivers it concurrently (the completing handler is then fenced
        // out and the message never retires). The generic 30s default is
        // unsafe against the dispatch budget.
        .outbox({ leaseDurationMs: LANGY_OUTBOX_LEASE_DURATION_MS }),
    )
    .withCommand("createConversation", CreateConversationCommand)
    .withCommand("forkConversation", ForkConversationCommand)
    .withCommand("recordMessage", RecordMessageCommand)
    .withCommand("importMessage", ImportMessageCommand)
    .withCommand("acceptAgentTurn", AcceptAgentTurnCommand)
    .withCommand("initiateToolCall", InitiateToolCallCommand)
    .withCommand("succeedToolCall", SucceedToolCallCommand)
    .withCommand("failToolCall", FailToolCallCommand)
    .withCommand("updatePlan", UpdatePlanCommand)
    .withCommand("failAgentResponse", FailAgentResponseCommand)
    .withCommand("recordAgentResponse", RecordAgentResponseCommand)
    .withCommand("archiveConversation", ArchiveConversationCommand)
    .withCommand("updateConversationMetadata", UpdateConversationMetadataCommand)
    .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
    .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
    .withCommand("generateConversationTitle", GenerateConversationTitleCommand)
    .build();
}
