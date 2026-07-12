import type { Projection } from "../../../";
import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import {
  LANGY_CONVERSATION_PROJECTION_VERSIONS,
  LANGY_CONVERSATION_STATUS,
  LANGY_TITLE_SOURCE,
  type LangyTitleSource,
} from "../schemas/constants";
import type {
  LangyAgentResponseFailedEvent,
  LangyAgentResponseStartedEvent,
  LangyAgentRespondedEvent,
  LangyConversationArchivedEvent,
  LangyConversationContinuedEvent,
  LangyConversationHandoffConsumedEvent,
  LangyConversationHandoffPendingEvent,
  LangyConversationMetadataUpdatedEvent,
  LangyConversationTitleGeneratedEvent,
  LangyToolCallFailedEvent,
  LangyToolCallInitiatedEvent,
  LangyToolCallSucceededEvent,
} from "../schemas/events";
import {
  LangyAgentResponseFailedEventSchema,
  LangyAgentResponseStartedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationContinuedEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
  LangyToolCallFailedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
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
  /**
   * Where `Title` came from — governs auto-regeneration precedence:
   * `derived` (first-message placeholder) → may be replaced by an auto title;
   * `auto` (cheap-model regeneration) → may be refined by a later regeneration;
   * `user` (manual rename) → sticky, never overridden by an auto title.
   */
  TitleSource: LangyTitleSource;
  Status: string;
  IsShared: boolean;
  SharedAt: number | null;
  SharedById: string | null;
  MessageCount: number;
  LastActivityAt: number | null;
  /**
   * The turn currently in flight, or null when idle. Set by the durable
   * `agent_response_started`, cleared by `agent_responded` / `agent_response_failed`.
   * Turn LIVENESS (is the worker still alive?) is NOT tracked here — it is a
   * purely ephemeral concern that lives in the Redis signal buffer (ADR-046);
   * PR3's orphan detection compares "CurrentTurnId set" against ephemeral
   * heartbeat recency.
   */
  CurrentTurnId: string | null;
  LastError: string | null;
  /**
   * ADR-048 shutdown-handoff. When a turn checkpoints on pod termination it
   * leaves an opaque, worker-authored resume token here; the next turn threads
   * it to a fresh worker and clears it. Null when there is nothing to resume.
   * The token is opaque to the pipeline — stored verbatim, only opencode reads
   * it. PendingHandoffTurnId is the turn that handed off (idempotent consume).
   */
  PendingHandoffToken: string | null;
  PendingHandoffTurnId: string | null;
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
  LangyConversationContinuedEventSchema,
  LangyAgentResponseStartedEventSchema,
  LangyToolCallInitiatedEventSchema,
  LangyToolCallSucceededEventSchema,
  LangyToolCallFailedEventSchema,
  LangyAgentResponseFailedEventSchema,
  LangyAgentRespondedEventSchema,
  LangyConversationArchivedEventSchema,
  LangyConversationMetadataUpdatedEventSchema,
  LangyConversationHandoffPendingEventSchema,
  LangyConversationHandoffConsumedEventSchema,
  LangyConversationTitleGeneratedEventSchema,
] as const;

/**
 * Type-safe fold projection for Langy conversation state.
 *
 * - `implements FoldEventHandlers` enforces a handler for every event schema.
 * - Handler names are derived from event type strings (e.g.
 *   `"lw.langy_conversation.conversation_continued"` -> `handleLangyConversationConversationContinued`).
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
      TitleSource: LANGY_TITLE_SOURCE.DERIVED,
      Status: LANGY_CONVERSATION_STATUS.ACTIVE,
      IsShared: false,
      SharedAt: null,
      SharedById: null,
      MessageCount: 0,
      LastActivityAt: null,
      CurrentTurnId: null,
      LastError: null,
      PendingHandoffToken: null,
      PendingHandoffTurnId: null,
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

  handleLangyConversationConversationContinued(
    event: LangyConversationContinuedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    const derivedTitle =
      event.data.title && event.data.title.length > 0 ? event.data.title : null;
    // First non-empty title wins (a placeholder derived from the first message).
    const title = state.Title ?? derivedTitle;
    // Only stamp `derived` when THIS message is the one that first set the
    // title. Once a title exists (derived/auto/user), the source is untouched —
    // a later message must never demote a user/auto title back to derived.
    const titleSource =
      state.Title == null && derivedTitle != null
        ? LANGY_TITLE_SOURCE.DERIVED
        : state.TitleSource;

    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      // First writer wins: the first message's userId owns the conversation.
      UserId: state.UserId || event.data.userId,
      Title: title,
      TitleSource: titleSource,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.ACTIVE),
      MessageCount: state.MessageCount + 1,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentResponseStarted(
    event: LangyAgentResponseStartedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.RUNNING),
      CurrentTurnId: event.data.turnId,
      LastActivityAt: event.occurredAt,
    };
  }

  // Tool calls are DURABLE, meaningful transitions (an audit of what the agent
  // did during the response); they bump LastActivityAt. They are NOT liveness
  // heartbeats — those are ephemeral (status/progress) and never reach the fold.
  // A call is initiated, then reaches exactly one terminal: succeeded or failed.
  handleLangyConversationToolCallInitiated(
    event: LangyToolCallInitiatedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationToolCallSucceeded(
    event: LangyToolCallSucceededEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationToolCallFailed(
    event: LangyToolCallFailedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      LastActivityAt: event.occurredAt,
    };
  }

  handleLangyConversationAgentResponseFailed(
    event: LangyAgentResponseFailedEvent,
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

  handleLangyConversationAgentResponded(
    event: LangyAgentRespondedEvent,
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
      // A manual rename is sticky: mark the source `user` so no later auto
      // regeneration can override it. Clearing the title (null) still counts
      // as a deliberate user choice.
      next.TitleSource = LANGY_TITLE_SOURCE.USER;
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

  // ADR-048: a turn checkpointed on shutdown. Store the opaque resume token and
  // the turn it belongs to, CLEAR CurrentTurnId (the turn handed off — it did
  // not fail), and return the conversation to idle so the next message can pick
  // the token up. Never un-archives (nextStatus guards it).
  handleLangyConversationConversationHandoffPending(
    event: LangyConversationHandoffPendingEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      Status: this.nextStatus(state, LANGY_CONVERSATION_STATUS.IDLE),
      CurrentTurnId: null,
      PendingHandoffToken: event.data.token,
      PendingHandoffTurnId: event.data.turnId,
      LastActivityAt: event.occurredAt,
    };
  }

  // ADR-048: the next turn threaded the pending token to a fresh worker. Clear
  // it so it is consumed exactly once. Idempotent on the command, so replaying
  // this is a no-op on an already-cleared fold.
  handleLangyConversationConversationHandoffConsumed(
    event: LangyConversationHandoffConsumedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    return {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
      PendingHandoffToken: null,
      PendingHandoffTurnId: null,
    };
  }

  /**
   * An auto title from the regeneration reactor. Updates the title ONLY when
   * the user has not renamed the conversation — a `user` source is sticky and
   * wins over any auto title, even on replay (the reactor already gates on
   * this, but the fold enforces it so a stale/replayed title_generated can
   * never clobber a manual rename). No activity bump / count change: an auto
   * title is metadata refinement, not conversational activity.
   */
  handleLangyConversationConversationTitleGenerated(
    event: LangyConversationTitleGeneratedEvent,
    state: LangyConversationStateData,
  ): LangyConversationStateData {
    const base = {
      ...state,
      ConversationId: state.ConversationId || event.data.conversationId,
    };
    if (state.TitleSource === LANGY_TITLE_SOURCE.USER) {
      return base;
    }
    return {
      ...base,
      Title: event.data.title,
      TitleSource: LANGY_TITLE_SOURCE.AUTO,
    };
  }
}
