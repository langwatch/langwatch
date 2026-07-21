/**
 * The Langy conversation SPINE fold — the whole reduction of a conversation's
 * durable events into its operational state, as one pure module (ADR-059 §1),
 * exactly like `turnFold.ts` for the per-turn document.
 *
 * The server's `LangyConversationStateFoldProjection` delegates every handler
 * here; a browser spine fold (ADR-059 Phase 4, client half) will call the same
 * function. NOTE the state deliberately models the server-only columns
 * (RunToken, PendingHandoffToken) — they are part of the fold's truth — but
 * they never ride the client wire: the tail read serves only the turn
 * vocabulary, and any future spine wire schema must exclude them explicitly.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_STATUS,
  LANGY_TITLE_SOURCE,
  type LangyTitleSource,
} from "./constants";
import type {
  LangyAgentResponseFailedEventData,
  LangyAgentRespondedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyConversationArchivedEventData,
  LangyConversationForkedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationStartedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyMessageImportedEventData,
  LangyMessageRecordedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "./events";

/**
 * Conversation-level operational state. It holds no message content; the
 * per-message content lives in the separate message projection.
 *
 * State = stored data: one type, not two. The fold does all computation; the
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
   * `agent_turn_accepted`, cleared by `agent_responded` / `agent_response_failed`.
   * Turn LIVENESS (is the worker still alive?) is NOT tracked here — it is a
   * purely ephemeral concern that lives in the Redis signal buffer (ADR-046).
   */
  CurrentTurnId: string | null;
  LastError: string | null;
  /**
   * ADR-048 shutdown-handoff. When a turn checkpoints on pod termination it
   * leaves an opaque, worker-authored resume token here; the next turn threads
   * it to a fresh worker and clears it. Null when there is nothing to resume.
   * SERVER-ONLY: never surfaced to a client.
   */
  PendingHandoffToken: string | null;
  PendingHandoffTurnId: string | null;
  /**
   * The per-conversation `runToken`: the HMAC key for authenticating the
   * worker's stream frames. Set once from `conversation_started`
   * (first-writer-wins). SERVER-ONLY: read only by the worker-provisioning
   * path, never by list/detail reads, the turn render fold, or any wire.
   */
  RunToken: string | null;
  ArchivedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

/** The fold-owned fields, before the projection machinery stamps bookkeeping. */
export type LangyConversationStateFoldState = Omit<
  LangyConversationStateData,
  "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
>;

export function initLangyConversationState(): LangyConversationStateFoldState {
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
    RunToken: null,
    ArchivedAt: null,
  };
}

/** The portable shape of one spine event: what the fold actually reads. */
interface SpineFoldEvent<Type extends string, Data> {
  type: Type;
  occurredAt: number;
  data: Data;
}

/** The whole spine vocabulary, discriminated on `type`. */
export type LangyConversationStateEvent =
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED,
      LangyConversationStartedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED,
      LangyConversationForkedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED,
      LangyMessageRecordedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED,
      LangyMessageImportedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED,
      LangyAgentTurnAcceptedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED,
      LangyToolCallInitiatedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED,
      LangyToolCallSucceededEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED,
      LangyToolCallFailedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED,
      LangyAgentResponseFailedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED,
      LangyAgentRespondedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED,
      LangyConversationArchivedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED,
      LangyConversationMetadataUpdatedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING,
      LangyConversationHandoffPendingEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED,
      LangyConversationHandoffConsumedEventData
    >
  | SpineFoldEvent<
      typeof LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED,
      LangyConversationTitleGeneratedEventData
    >;

/**
 * An archived conversation stays archived regardless of what a later event
 * proposes — replay determinism, and a stray late message can't un-archive.
 */
function nextStatus(
  state: LangyConversationStateFoldState,
  proposed: string,
): string {
  return state.ArchivedAt != null
    ? LANGY_CONVERSATION_STATUS.ARCHIVED
    : proposed;
}

/** Fold ONE spine event onto the conversation state. Pure and total. */
export function foldLangyConversationState<
  S extends LangyConversationStateFoldState,
>(state: S, event: LangyConversationStateEvent): S {
  switch (event.type) {
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED: {
      const initialTitle =
        event.data.title && event.data.title.length > 0
          ? event.data.title
          : null;
      // First writer wins for owner/title; an explicit creation seeds them
      // before any message, but never demotes an existing title source.
      const title = state.Title ?? initialTitle;
      const titleSource =
        state.Title == null && initialTitle != null
          ? LANGY_TITLE_SOURCE.DERIVED
          : state.TitleSource;
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        UserId: state.UserId || event.data.userId,
        Title: title,
        TitleSource: titleSource,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.ACTIVE),
        LastActivityAt: state.LastActivityAt ?? event.occurredAt,
        // First-writer-wins: the runToken is minted once at creation and never
        // rotated, so an already-set value survives a (retried) started event.
        RunToken: state.RunToken ?? event.data.runToken ?? null,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        UserId: state.UserId || event.data.userId,
        Title: state.Title ?? event.data.title,
        // A fork title is chosen as part of the user's explicit fork action.
        // Keep it sticky so the title process cannot later rename the copy.
        TitleSource:
          state.Title == null ? LANGY_TITLE_SOURCE.USER : state.TitleSource,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.IDLE),
        LastActivityAt: state.LastActivityAt ?? event.occurredAt,
        RunToken: state.RunToken ?? event.data.runToken,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED: {
      const derivedTitle =
        event.data.title && event.data.title.length > 0
          ? event.data.title
          : null;
      // First non-empty title wins (a placeholder from the first message).
      const title = state.Title ?? derivedTitle;
      // Only stamp `derived` when THIS message is the one that first set the
      // title. Once a title exists (derived/auto/user), the source is
      // untouched — a later message must never demote a user/auto title.
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
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.ACTIVE),
        MessageCount: state.MessageCount + 1,
        LastActivityAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_IMPORTED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.IDLE),
        MessageCount: state.MessageCount + 1,
        LastActivityAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_TURN_ACCEPTED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.RUNNING),
        CurrentTurnId: event.data.turnId,
        LastActivityAt: event.occurredAt,
      };
    }
    // Tool calls are DURABLE, meaningful transitions (an audit of what the
    // agent did); they bump LastActivityAt. They are NOT liveness heartbeats —
    // those are ephemeral and never reach the fold.
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_INITIATED:
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_SUCCEEDED:
    case LANGY_CONVERSATION_EVENT_TYPES.TOOL_CALL_FAILED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        LastActivityAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONSE_FAILED: {
      // Only the turn CURRENTLY in flight can fail. A late failure for a turn
      // that already reached a terminal must not overwrite a completed
      // conversation with FAILED + LastError — that buried successful answers
      // under an error card. The event still exists on the log (audit); the
      // fold just refuses to let it regress the state.
      if (event.data.turnId !== state.CurrentTurnId) {
        return {
          ...state,
          ConversationId: state.ConversationId || event.data.conversationId,
        };
      }
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.FAILED),
        CurrentTurnId: null,
        LastError: event.data.error,
        LastActivityAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.AGENT_RESPONDED: {
      const failed = event.data.outcome === "failed";
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        // The final answer is one message on the conversation.
        MessageCount: state.MessageCount + 1,
        Status: nextStatus(
          state,
          failed
            ? LANGY_CONVERSATION_STATUS.FAILED
            : LANGY_CONVERSATION_STATUS.IDLE,
        ),
        CurrentTurnId: null,
        LastError: failed ? (event.data.error ?? "unknown error") : null,
        LastActivityAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        Status: LANGY_CONVERSATION_STATUS.ARCHIVED,
        ArchivedAt: event.occurredAt,
      };
    }
    case LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED: {
      const next = { ...state };
      next.ConversationId = state.ConversationId || event.data.conversationId;
      if (event.data.title !== undefined) {
        next.Title = event.data.title;
        // A manual rename is sticky: mark the source `user` so no later auto
        // regeneration can override it. Clearing the title (null) still
        // counts as a deliberate user choice.
        next.TitleSource = LANGY_TITLE_SOURCE.USER;
      }
      if (event.data.isShared !== undefined) {
        next.IsShared = event.data.isShared;
        next.SharedAt = event.data.isShared ? event.occurredAt : null;
        next.SharedById = event.data.isShared
          ? (event.data.sharedById ?? state.SharedById ?? null)
          : null;
      }
      return next;
    }
    // ADR-048: a turn checkpointed on shutdown. Store the opaque resume token
    // and the turn it belongs to, CLEAR CurrentTurnId (the turn handed off —
    // it did not fail), and return the conversation to idle so the next
    // message can pick the token up. Never un-archives (nextStatus guards it).
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_PENDING: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        Status: nextStatus(state, LANGY_CONVERSATION_STATUS.IDLE),
        CurrentTurnId: null,
        PendingHandoffToken: event.data.token,
        PendingHandoffTurnId: event.data.turnId,
        LastActivityAt: event.occurredAt,
      };
    }
    // ADR-048: the next turn threaded the pending token to a fresh worker.
    // Clear it so it is consumed exactly once. Idempotent on the command, so
    // replaying this is a no-op on an already-cleared fold.
    case LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_HANDOFF_CONSUMED: {
      return {
        ...state,
        ConversationId: state.ConversationId || event.data.conversationId,
        PendingHandoffToken: null,
        PendingHandoffTurnId: null,
      };
    }
    // An auto title from the process-outbox title effect. Updates the title
    // ONLY when the user has not renamed the conversation — a `user` source is
    // sticky and wins over any auto title, even on replay. No activity bump /
    // count change: an auto title is metadata refinement, not activity.
    case LANGY_CONVERSATION_EVENT_TYPES.TITLE_GENERATED: {
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
}
