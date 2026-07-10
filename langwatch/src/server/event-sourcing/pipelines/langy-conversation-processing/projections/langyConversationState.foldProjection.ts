import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import {
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  LANGY_CONVERSATION_STATUS,
} from "../schemas/constants";
import type {
  LangyAgentRespondedEvent,
  LangyAgentTurnCompletedEvent,
  LangyAgentTurnFailedEvent,
  LangyAgentTurnStartedEvent,
  LangyConversationArchivedEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyMessageSentEvent,
  LangyProgressReportedEvent,
  LangyStatusReportedEvent,
  LangyToolCallCompletedEvent,
  LangyToolCallStartedEvent,
  LangyTurnFinalizedEvent,
} from "../schemas/events";
import {
  LangyAgentRespondedEventSchema,
  LangyAgentTurnCompletedEventSchema,
  LangyAgentTurnFailedEventSchema,
  LangyAgentTurnStartedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyMessageSentEventSchema,
  LangyProgressReportedEventSchema,
  LangyStatusReportedEventSchema,
  LangyToolCallCompletedEventSchema,
  LangyToolCallStartedEventSchema,
  LangyTurnFinalizedEventSchema,
} from "../schemas/events";

/**
 * Conversation-level fold state. This is the spine that replaces the Postgres
 * `LangyConversation` row. Holds NO message content — the per-message content
 * lives in `langy_messages` via the map projection. Matches the
 * `langy_conversations` ClickHouse table.
 *
 * State = stored data: one type, not two. Handlers do all computation; the
 * store is a dumb read/write layer.
 */
export interface LangyConversationStateData {
  ConversationId: string;
  /** Owner. Set once, from the first message (first-writer-wins). */
  UserId: string;
  Title: string | null;
  Status: string;
  IsShared: boolean;
  SharedAt: number | null;
  SharedById: string | null;
  MessageCount: number;
  LastActivityAt: number | null;
  /** Liveness signal from status/progress/tool heartbeats during a turn. */
  LastHeartbeatAt: number | null;
  /** The turn currently in flight, or null when idle. */
  CurrentTurnId: string | null;
  LastError: string | null;
  ArchivedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

export interface LangyConversationState
  extends Projection<LangyConversationStateData> {
  data: LangyConversationStateData;
}

const langyConversationEvents = [
  LangyMessageSentEventSchema,
  LangyAgentTurnStartedEventSchema,
  LangyToolCallStartedEventSchema,
  LangyToolCallCompletedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyAgentTurnCompletedEventSchema,
  LangyAgentTurnFailedEventSchema,
  LangyStatusReportedEventSchema,
  LangyProgressReportedEventSchema,
  LangyTurnFinalizedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
] as const;

/**
 * Type-safe fold projection for Langy conversation state.
 *
 * - `implements FoldEventHandlers` enforces a handler for every event schema.
 * - Handler names are derived from event type strings (e.g.
 *   `"lw.langy_conversation.message_sent"` -> `handleLangyConversationMessageSent`).
 * - `CreatedAt` / `UpdatedAt` / `LastEventOccurredAt` are auto-managed by the base.
 */
export class LangyConversationStateFoldProjection
  extends AbstractFoldProjection<
    LangyConversationStateData,
    typeof langyConversationEvents
  >
  implements
    FoldEventHandlers<
      typeof langyConversationEvents,
      LangyConversationStateData
    >
{
  readonly name = "langyConversationState";
  readonly version = LANGY_CONVERSATION_PROJECTION_VERSIONS.CONVERSATION_STATE;
  readonly store: FoldProjectionStore<LangyConversationStateData>;

  protected readonly events = langyConversationEvents;

  constructor(deps: {
    store: FoldProjectionStore<LangyConversationStateData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      ConversationId: "",
      UserId: "",
      Title: null,
      Status: LANGY_CONVERSATION_STATUS.ACTIVE,
      IsShared: false,
      SharedAt: null,
      SharedById: null,
      MessageCount: 0,
      LastActivityAt: null,
      LastHeartbeatAt: null,
      CurrentTurnId: null,
      LastError: null,
      ArchivedAt: null,
    };
  }

  /**
   * An archived conversation stays archived regardless of what a later event
   * proposes — replay determinism, and a stray late message can't un-archive.
   */
  private nextStatus(
    state: LangyConversationStateData,
    proposed: string,
  ): string {
    return state.ArchivedAt != null
      ? LANGY_CONVERSATION_STATUS.ARCHIVED
      : proposed;
  }

  handleLangyConversationMessageSent(
    event: LangyMessageSentEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    const title =
      state.Title ??
      (event.data.title && event.data.title.length > 0
        ? event.data.title
        : null);

    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      // First writer wins: the first message's userId owns the conversation.
      UserId: state.UserId || event.data.userId,
      Title: title,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.ACTIVE),
      MessageCount: state.MessageCount + 1,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentTurnStarted(
    event: LangyAgentTurnStartedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.RUNNING),
      CurrentTurnId: event.data.turnId,
      LastActivityAt: event.occurredAt,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationToolCallStarted(
    event: LangyToolCallStartedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationToolCallCompleted(
    event: LangyToolCallCompletedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastActivityAt: event.occurredAt,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentTurnCompleted(
    event: LangyAgentTurnCompletedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.IDLE),
      CurrentTurnId: null,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentTurnFailed(
    event: LangyAgentTurnFailedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.FAILED),
      CurrentTurnId: null,
      LastError: event.data.error,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationStatusReported(
    event: LangyStatusReportedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    // Heartbeat only — the reported status string is a transient live-UI label,
    // not the lifecycle Status.
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationProgressReported(
    event: LangyProgressReportedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastHeartbeatAt: event.occurredAt,
    };
  }

  handleLangyConversationTurnFinalized(
    event: LangyTurnFinalizedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    const failed = event.data.outcome === "failed";
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      // The final answer is one message on the conversation.
      MessageCount: state.MessageCount + 1,
      Status: this.nextStatus(
        state,
        failed
          ? LANGY_CONVERSATION_STATUS.FAILED
          : LANGY_CONVERSATION_STATUS.IDLE,
      ),
      CurrentTurnId: null,
      LastError: failed ? event.data.error ?? "unknown error" : null,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationConversationArchived(
    event: LangyConversationArchivedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: LANGY_CONVERSATION_STATUS.ARCHIVED,
      ArchivedAt: event.occurredAt,
    };
  }

  handleLangyConversationConversationMetadataUpdated(
    event: LangyConversationMetadataUpdatedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    const next = { ...state };
    next.ConversationId = state.ConversationId || event.data.conversationId;
    if (event.data.title !== undefined) {
      next.Title = event.data.title;
    }
    if (event.data.isShared !== undefined) {
      next.IsShared = event.data.isShared;
      next.SharedAt = event.data.isShared ? event.occurredAt : null;
      next.SharedById = event.data.isShared
        ? event.data.sharedById ?? state.SharedById ?? null
        : null;
    }
    return next;
  }
}
