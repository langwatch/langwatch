import { definePipeline } from "../../";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
import type { AppendStore } from "../../projections/mapProjection.types";
import {
  ArchiveConversationCommand,
  ReconcileAgentTurnCommand,
  ReportProgressCommand,
  ReportStatusCommand,
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
 * - reportStatus / reportProgress: worker heartbeats -> status/progress_reported
 * - reconcileAgentTurn: streamed answer completes -> turn_finalized
 * - archiveConversation: soft-delete -> conversation_archived
 * - updateConversationMetadata: rename/share -> conversation_metadata_updated
 *
 * The turn-lifecycle events (tool_call_*, agent_responded,
 * agent_turn_completed/failed) are defined with fold handlers but their
 * dispatching worker/reactor is PR3.
 */
export function createLangyConversationProcessingPipeline(
  deps: LangyConversationProcessingPipelineDeps,
) {
  return definePipeline<LangyConversationProcessingEvent>()
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
    )
    .withCommand("sendMessage", SendMessageCommand)
    .withCommand("startAgentTurn", StartAgentTurnCommand)
    .withCommand("reportStatus", ReportStatusCommand)
    .withCommand("reportProgress", ReportProgressCommand)
    .withCommand("reconcileAgentTurn", ReconcileAgentTurnCommand)
    .withCommand("archiveConversation", ArchiveConversationCommand)
    .withCommand("updateConversationMetadata", UpdateConversationMetadataCommand)
    .build();
}
