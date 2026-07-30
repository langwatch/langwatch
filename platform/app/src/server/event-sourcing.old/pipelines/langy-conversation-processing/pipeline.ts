import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy";
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
import {
  createLangyEffectPorts,
  LANGY_CONVERSATION_PROCESS_NAME,
  langyConversationPM,
} from "~/server/event-sourcing.old/pipelines/langy-conversation-processing/process-manager";
import { definePipeline } from "../../";
import type { CommandBus } from "../../commands/commandBus";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import {
  AcceptAgentTurnCommand,
  ArchiveConversationCommand,
  ConsumeTurnHandoffCommand,
  CreateConversationCommand,
  FailAgentResponseCommand,
  FailToolCallCommand,
  ForkConversationCommand,
  GenerateConversationTitleCommand,
  ImportMessageCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  RecordMessageCommand,
  RecordTurnHandoffCommand,
  SucceedToolCallCommand,
  UpdateConversationMetadataCommand,
  UpdatePlanCommand,
} from "./commands";
import { createLangyConversationReader } from "./conversationReader.adapter";
import {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "./projections/langyAnalyticsEvent.mapProjection";
import { LangyConversationStateFoldProjection } from "./projections/langyConversationState.foldProjection";
import { LangyConversationTurnFoldProjection } from "./projections/langyConversationTurn.foldProjection";
import { LangyMessageOperationalMapProjection } from "./projections/langyMessageOperational.mapProjection";
import type { LangyConversationProcessingEvent } from "./schemas/events";
import { createLangySelfCommandPorts } from "./selfCommands.adapter";

/**
 * ADR-102 — nothing here is a value the builder registers. The three
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
  /** Ephemeral Redis heartbeat and stream tail (ADR-098). */
  tokenBuffer: Pick<
    LangyTokenBuffer,
    "liveness" | "appendStatus" | "markError"
  >;
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
  /** ADR-102 — identity-keyed dispatch into this pipeline's own commands. */
  commands: CommandBus;
}

/**
 * Creates the langy-conversation-processing pipeline definition (ADR-098).
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
 * Status/progress are EPHEMERAL signals (ADR-098): NOT commands and NOT durable
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

  return (
    definePipeline<LangyConversationProcessingEvent>()
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
      .withProcessManager(
        LANGY_CONVERSATION_PROCESS_NAME,
        langyConversationPM(effects),
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
      .withCommand(
        "updateConversationMetadata",
        UpdateConversationMetadataCommand,
      )
      .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
      .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
      .withCommand(
        "generateConversationTitle",
        GenerateConversationTitleCommand,
      )
      .build()
  );
}
