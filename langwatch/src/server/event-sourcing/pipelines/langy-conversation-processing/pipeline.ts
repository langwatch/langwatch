import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import {
  ArchiveConversationCommand,
  ConsumeTurnHandoffCommand,
  FailAgentTurnCommand,
  RecordAgentRespondedCommand,
  RecordToolCallCompletedCommand,
  RecordToolCallStartedCommand,
  RecordTurnHandoffCommand,
  ReconcileAgentTurnCommand,
  SendMessageCommand,
  StartAgentTurnCommand,
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
import type { LangyConversationProcessingEvent } from "./schemas/events";

export interface LangyConversationProcessingPipelineDeps {
  langyConversationStateFoldStore: FoldProjectionStore<LangyConversationStateData>;
  langyMessageAppendStore: AppendStore<ClickHouseLangyMessageRecord>;
  /**
   * PR3 (ADR-044): reacts to `agent_turn_started` and dispatches the turn to
   * the `LangyWorkerPool`. Optional so the PR2 shape (no reactor) still builds.
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
 * Map Projection: langyMessageStorage
 * - Per-message rows for `message_sent` (user) and `turn_finalized`
 *   (assistant), stored in the existing langy_messages table.
 *
 * Commands (PR2 write surface):
 * - sendMessage: user turn -> message_sent
 * - startAgentTurn: agent turn begins -> agent_turn_started
 * - reconcileAgentTurn: streamed answer completes -> turn_finalized
 * - archiveConversation: soft-delete -> conversation_archived
 * - updateConversationMetadata: rename/share -> conversation_metadata_updated
 *
 * The turn-lifecycle events (tool_call_*, agent_responded,
 * agent_turn_completed/failed) are defined with fold handlers but their
 * dispatching worker/reactor is PR3.
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

  return builder
    .withCommand("sendMessage", SendMessageCommand)
    .withCommand("startAgentTurn", StartAgentTurnCommand)
    .withCommand("recordToolCallStarted", RecordToolCallStartedCommand)
    .withCommand("recordToolCallCompleted", RecordToolCallCompletedCommand)
    .withCommand("recordAgentResponded", RecordAgentRespondedCommand)
    .withCommand("failAgentTurn", FailAgentTurnCommand)
    .withCommand("reconcileAgentTurn", ReconcileAgentTurnCommand)
    .withCommand("archiveConversation", ArchiveConversationCommand)
    .withCommand("updateConversationMetadata", UpdateConversationMetadataCommand)
    .withCommand("recordTurnHandoff", RecordTurnHandoffCommand)
    .withCommand("consumeTurnHandoff", ConsumeTurnHandoffCommand)
    .build();
}
