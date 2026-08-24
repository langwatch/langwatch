import {
  type AppendStore,
  defineAggregate,
  defineEvents,
  definePipeline,
  type EventSubscriberDefinition,
  type StateProjectionStore,
} from "@langwatch/eventing";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import { LANGY_CONVERSATION_PROCESSING_EVENT_TYPES } from "@langwatch/langy-contract";
import { langyConversationProcess } from "../processes/langy-conversation.process";
import { LANGY_CONVERSATION_PROCESS_NAME } from "../ports/langy-conversation-process.port";
import type { LangyEffectPorts } from "../ports/langy-effect.port";
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
} from "../intents/langy-conversation.intent";
import {
  LangyAnalyticsEventMapProjection,
  type LangyAnalyticsEventProjectionRecord,
} from "../projections/langy-analytics-event.projection";
import { LangyConversationStateFoldProjection } from "../projections/langy-conversation-state.projection";
import { LangyConversationTurnFoldProjection } from "../projections/langy-conversation-turn.projection";
import { LangyMessageOperationalMapProjection } from "../projections/langy-message-operational.projection";
import type { LangyConversationProcessingEvent } from "./eventing.langy.adapter";

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
  let builder = definePipeline<LangyConversationProcessingEvent>({
    name: "langy_conversation_processing",
    aggregate: defineAggregate({
      type: "langy_conversation",
      events: defineEvents(LANGY_CONVERSATION_PROCESSING_EVENT_TYPES),
    }),
  })
    .withPostgresProjection(
      new LangyConversationStateFoldProjection({
        store: deps.langyConversationProjectionStore,
      }),
    )
    .withPostgresProjection(
      new LangyConversationTurnFoldProjection({
        store: deps.langyConversationTurnProjectionStore,
      }),
    )
    .withClickHouseMapProjection(
      new LangyMessageOperationalMapProjection({
        store: deps.langyMessageProjectionStore,
      }),
    )
    .withClickHouseMapProjection(
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
    .withCommand(
      "updateConversationMetadata",
      UpdateConversationMetadataCommand,
    )
    .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
    .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
    .withCommand("generateConversationTitle", GenerateConversationTitleCommand)
    .build();
}
