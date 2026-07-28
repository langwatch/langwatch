import { definePipeline } from "../../";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import {
  langyConversationProcess,
  LANGY_CONVERSATION_PROCESS_NAME,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing/process-manager";
import type { LangyEffectPorts } from "~/server/event-sourcing/pipelines/langy-conversation-processing/process-manager";
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
  /** Live consumers are independent from projection state and replay. */
  subscribers?: EventSubscriberDefinition<LangyConversationProcessingEvent>[];
  /**
   * Effect ports the conversation process manager dispatches into. Only the
   * effects are injected -- the process topology is declared on this pipeline.
   */
  langyProcessPorts: LangyEffectPorts;
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
  let builder = definePipeline<LangyConversationProcessingEvent>()
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
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withProcessManager(
      LANGY_CONVERSATION_PROCESS_NAME,
      langyConversationProcess(deps.langyProcessPorts),
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
