import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  ArchiveConversationCommand,
  ConsumeTurnHandoffCommand,
  ContinueConversationCommand,
  CreateAgentResponseCommand,
  FailAgentResponseCommand,
  FailToolCallCommand,
  GenerateConversationTitleCommand,
  InitiateToolCallCommand,
  RecordAgentResponseCommand,
  RecordTurnHandoffCommand,
  SucceedToolCallCommand,
  UpdateConversationMetadataCommand,
} from "./commands";
import {
  type ClickHouseLangyMessageRecord,
  LangyMessageStorageMapProjection,
} from "./projections/langyMessageStorage.mapProjection";
import {
  type LangyConversationStateData,
  LangyConversationStateFoldProjection,
} from "./projections/langyConversationState.foldProjection";
import {
  type LangyConversationTurnData,
  LangyConversationTurnFoldProjection,
} from "./projections/langyConversationTurn.foldProjection";
import type { LangyConversationProcessingEvent } from "./schemas/events";

export interface LangyConversationProcessingPipelineDeps {
  langyConversationStateFoldStore: FoldProjectionStore<LangyConversationStateData>;
  /**
   * Per-turn render document (langyConversationTurn): a second fold over the same
   * stream, keyed by `${conversationId}:${turnId}`. Folds one turn into its final
   * state (status, answer parts, tool-call lifecycle) for one-read rendering.
   */
  langyConversationTurnFoldStore: FoldProjectionStore<LangyConversationTurnData>;
  langyMessageAppendStore: AppendStore<ClickHouseLangyMessageRecord>;
  /**
   * PR3 (ADR-044): reacts to `agent_response_started` and dispatches the turn
   * to the `LangyWorkerPool`. Optional so the PR2 shape (no reactor) still builds.
   */
  spawnAgentReactor?: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
  /**
   * PR3 (ADR-044): a delayed per-turn timer that reconciles a stalled turn to a
   * terminal state when its heartbeat lapses. Optional for the same reason.
   */
  reconcileAgentTurnReactor?: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
  /**
   * Optional freshness-broadcast reactor. Emits a lightweight per-conversation
   * SSE signal on every fold advance so the panel can cancel + invalidate its
   * slim tRPC caches (ADR-046). Omitted (no-Redis dev) → no broadcast.
   */
  langyConversationUpdateBroadcastReactor?: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
  /**
   * Optional cheap-model title regeneration reactor. Fires on `agent_responded`
   * and dispatches `GenerateConversationTitle` when the throttle allows.
   * Optional so a no-model / test wiring omits it cleanly.
   */
  langyTitleGenerationReactor?: ReactorDefinition<
    LangyConversationProcessingEvent,
    LangyConversationStateData
  >;
}

/**
 * Creates the langy-conversation-processing pipeline definition (ADR-046).
 *
 * Aggregate: `langy_conversation` (aggregateId = conversationId,
 * TenantId = projectId). A Langy conversation is a projection of its event
 * stream; the Postgres spine is deleted.
 *
 * Fold Projection: langyConversationState
 * - Conversation-level spine (owner, title, status, counts, timestamps,
 *   sharing). Stored in the langy_conversations ClickHouse table.
 *
 * Fold Projection: langyConversationTurn
 * - Per-turn render document — a SECOND fold over the same stream, keyed by
 *   `${conversationId}:${turnId}` (the fold's custom key). Folds one turn into
 *   its final state (status, answer parts, tool-call lifecycle). Stored in the
 *   langy_conversation_turns ClickHouse table.
 *
 * Map Projection: langyMessageStorage
 * - Per-message rows for `conversation_continued` (user) and `agent_responded`
 *   (assistant), stored in the existing langy_messages table.
 *
 * Commands (write surface):
 * - continueConversation: user turn -> conversation_continued
 * - createAgentResponse: agent response begins -> agent_response_started
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
    .withFoldProjection(
      "langyConversationState",
      new LangyConversationStateFoldProjection({
        store: deps.langyConversationStateFoldStore,
      }),
    )
    .withFoldProjection(
      "langyConversationTurn",
      new LangyConversationTurnFoldProjection({
        store: deps.langyConversationTurnFoldStore,
      }),
    )
    .withMapProjection(
      "langyMessageStorage",
      new LangyMessageStorageMapProjection({
        store: deps.langyMessageAppendStore,
      }),
    );

  if (deps.spawnAgentReactor) {
    builder = builder.withReactor(
      "langyConversationState",
      "spawnAgent",
      deps.spawnAgentReactor,
    );
  }
  if (deps.reconcileAgentTurnReactor) {
    builder = builder.withReactor(
      "langyConversationState",
      "reconcileAgentTurn",
      deps.reconcileAgentTurnReactor,
    );
  }
  // Freshness broadcast: bound to the conversation-state fold so it fires
  // whenever the spine advances. Optional so no-Redis dev omits it cleanly.
  if (deps.langyConversationUpdateBroadcastReactor) {
    builder = builder.withReactor(
      "langyConversationState",
      "langyConversationUpdateBroadcast",
      deps.langyConversationUpdateBroadcastReactor,
    );
  }
  // Cheap-model title regeneration: fires on turn_finalized, throttled.
  if (deps.langyTitleGenerationReactor) {
    builder = builder.withReactor(
      "langyConversationState",
      "langyTitleGeneration",
      deps.langyTitleGenerationReactor,
    );
  }

  return builder
    .withCommand("continueConversation", ContinueConversationCommand)
    .withCommand("createAgentResponse", CreateAgentResponseCommand)
    .withCommand("initiateToolCall", InitiateToolCallCommand)
    .withCommand("succeedToolCall", SucceedToolCallCommand)
    .withCommand("failToolCall", FailToolCallCommand)
    .withCommand("failAgentResponse", FailAgentResponseCommand)
    .withCommand("recordAgentResponse", RecordAgentResponseCommand)
    .withCommand("archiveConversation", ArchiveConversationCommand)
    .withCommand("updateConversationMetadata", UpdateConversationMetadataCommand)
    .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
    .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
    .withCommand("generateConversationTitle", GenerateConversationTitleCommand)
    .build();
}
