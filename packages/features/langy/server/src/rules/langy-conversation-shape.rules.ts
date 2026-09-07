/**
 * Reading a conversation's log without touching it: which developer folder was last attached,
 * how the wait cards fold out of the turn events, whether a caller-chosen id may be adopted as
 * a new conversation, and the two derived shapes the client is handed back.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  LangyConversationIdUnadoptableError,
  foldLangyConversationTurn,
  initLangyConversationTurnState,
  langyConversationTurnEventSchema,
  type LangyConversationTurnFoldState,
  type LangyEventCursor,
  type LangyLocalRecordWait,
} from "@langwatch/langy-contract";
import type { LangyConversationProcessingEvent } from "../projections/langy-conversation-state.projection.ts";
import type {
  LangyConversationListCursor,
  LangyConversationRow,
} from "../repositories/langy-conversation-projection.repository.ts";

/**
 * Adoptable ids are the shape a caller may propose. Anything else is refused before it
 * becomes an aggregate key.
 */
export const ADOPTABLE_CONVERSATION_ID = /^[A-Za-z0-9_-]{6,120}$/;

/** List-item shape the sidebar renders. Named for the domain, not the column. */
export type ConversationListItem = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  lastActivityAt: Date;
  messageCount: number;
};

/**
/** Detail shape returned when opening / mutating a single conversation. */
export type ConversationDetail = ConversationListItem & {
  status: string;
  /**
   * The turn in flight right now (`CurrentTurnId` on the fold), the durable
   * answer to "which turn would a Stop stop?" (ADR-078) — a browser tab that
   * merely adopted a turn (another tab's, or post-refresh) had no id to stop with.
   */
  currentTurnId: string | null;
  /**
   * Why the last turn failed (`agent_response_failed` sets it on the fold).
   * DURABLE, unlike the browser's `useChat` error, which used to leave a
   * refresh after a failed turn with no question, answer or explanation.
   */
  lastError: string | null;
  /**
   * The model the latest accepted turn ran on, or null before any turn
   * recorded one. Reopening the conversation seeds the composer's picker
   * from it, so a conversation keeps the model it was last used with.
   */
  lastModel: string | null;
  /**
   * The projection's event cursor (ADR-059): the snapshot position the client
   * seeds its local fold from before folding the durable tail.
   */
  eventCursor: LangyEventCursor | null;
};

export interface ConversationListPage {
  items: ConversationListItem[];
  nextCursor: LangyConversationListCursor | null;
}

/**
 * Whether the developer's folder is attached, as of the last connect or disconnect in the log.
 * Absent either, it was never attached.
 */
export function lastWorkspaceConnection(
  events: readonly LangyConversationProcessingEvent[],
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const type = events[i]?.type;
    if (type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED) {
      return true;
    }

    if (type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_DISCONNECTED) {
      return false;
    }
  }

  return false;
}

/**
 * One document per turn, folded from that turn's card events only: the waits ride on the tool
 * calls, and no other part of the vocabulary is needed to read them back.
 */
export function foldWaitTurns(
  events: readonly LangyConversationProcessingEvent[],
): Map<string, LangyConversationTurnFoldState> {
  const turns = new Map<string, LangyConversationTurnFoldState>();
  for (const event of events) {
    if (!isLangyWaitEventType(event.type)) {
      continue;
    }

    const parsed = langyConversationTurnEventSchema.safeParse({
      id: event.id,
      createdAt: event.createdAt,
      occurredAt: event.occurredAt,
      type: event.type,
      data: event.data,
    });
    if (!parsed.success) {
      continue;
    }

    const turnId = parsed.data.data.turnId;
    turns.set(
      turnId,
      foldLangyConversationTurn(turns.get(turnId) ?? initLangyConversationTurnState(), parsed.data),
    );
  }

  return turns;
}

/** Every card the folded turns carry, tagged with the turn that raised it. */
export function recordWaitsOf(
  turns: ReadonlyMap<string, LangyConversationTurnFoldState>,
): LangyLocalRecordWait[] {
  return [...turns].flatMap(([turnId, turn]) =>
    turn.ToolCalls.flatMap((call) =>
      call.wait ? [{ turnId, toolCallId: call.toolCallId, ...call.wait }] : [],
    ),
  );
}

/** The two events that carry a card, as the fold reads them. */
function isLangyWaitEventType(type: string): boolean {
  return (
    type === LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_STARTED ||
    type === LANGY_CONVERSATION_EVENT_TYPES.USER_WAIT_ENDED
  );
}

/**
 * Adopts a caller-chosen id as a NEW conversation, or refuses loudly — the
 * id becomes an aggregate key, gated before anything is written. Archived is
 * a refusal, not a resume: adopting would append to a closed aggregate.
 */
export function adoptConversationId(
  conversationId: string,
  ownership: "archived" | "missing",
): { id: string; isNew: boolean } {
  if (!ADOPTABLE_CONVERSATION_ID.test(conversationId)) {
    throw new LangyConversationIdUnadoptableError(conversationId, "invalid_shape");
  }

  if (ownership === "archived") {
    throw new LangyConversationIdUnadoptableError(conversationId, "archived");
  }

  return { id: conversationId, isNew: true };
}

/**
 * The assistant message id for a turn — deterministic, so however many
 * times finalize lands (relay + durable backup, retries) it dedups on
 * MessageId everywhere; ordering still sorts by CreatedAt first.
 */
export function turnMessageId(turnId: string): string {
  return `langymsg_turn-${turnId}`;
}

/**
 * Module-level (not a method) so the traced() proxy in presets.ts never wraps
 * it: it is sync and its results are spread/mapped — an async wrapper would
 * silently turn them into Promises.
 */
export function toListItem(row: LangyConversationRow, userId: string): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    isShared: row.isShared,
    isOwn: row.userId === userId,
    lastActivityAt: new Date(row.lastActivityAtMs > 0 ? row.lastActivityAtMs : row.createdAtMs),
    messageCount: row.messageCount,
  };
}
