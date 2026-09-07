import type { CommandEnvelope } from "@langwatch/eventing";
import { createTenantId, REHYDRATION_WINDOW_MS, type TenantId } from "@langwatch/eventing";
import type { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type {} from "@langwatch/langy-contract";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_TURN_EVENT_TYPES,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  type LangyLocalRecord,
  langyConversationTurnEventSchema,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { LangyTurnErrors } from "@langwatch/langy-contract";
import { mintRunToken } from "../ports/langy-frame-auth.port.ts";
import type { LangyConversationProcessingEvent } from "../projections/langy-conversation-state.projection.ts";
import { LANGY_ID_RESOURCES } from "../ports/langy-ids.port.ts";
import { LangyConversationNotFoundError } from "@langwatch/langy-contract";
import { type LangyFinalToolCall } from "./langy-final-parts.service.ts";
import type {
  LangyConversationListCursor,
  LangyConversationRepository,
} from "../repositories/langy-conversation-projection.repository.ts";
import {} from "../repositories/langy-message.repository.ts";
import type { LangyTurnSegment } from "./langy-turn-order.service.ts";

import {
  foldWaitTurns,
  lastWorkspaceConnection,
  recordWaitsOf,
  toListItem,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationListPage,
} from "../rules/langy-conversation-shape.rules.ts";
import type { LangyConversationEventsReader } from "./langy-conversation.service.ts";

/**
 * Hard ceiling on one tail response — a conversation's whole event set is
 * inherently small, so hitting it means something is wrong. The client gets
 * a truncated flag and resumes from the cursor; we log rather than silently cap.
 */
const CONVERSATION_EVENT_TAIL_LIMIT = 1_000;

/**
 * How long a read waits out the dispatch window (accept -> projection row).
 * 1.5s was not enough: a cold-worker wake takes longer than the projector's
 * usual latency, so the read arrived before the row and reported false absence.
 */
const DISPATCH_LAG_ATTEMPTS = 12;
const DISPATCH_LAG_RETRY_MS = 400;
/**
 * How many attempts may pass with no pending handoff before concluding the id
 * is unknown. Cannot be zero: the handoff row is written by the dispatch
 * itself, so an immediate read can find no evidence and wrongly return not-found.
 */
const DISPATCH_HANDOFF_GRACE_ATTEMPTS = 3;

const conversationServiceLogger = createLogger("langwatch:langy:conversation-service");

/**
 * Reading a conversation back: one by id, the event tail after a cursor, the local-control
 * record, and the sidebar's list and page. Every read tolerates the dispatch window, where an
 * accepted create has a pending handoff before its projection row lands.
 */
type LangyConversationReadOptions = {
  repository: LangyConversationRepository;
  events: LangyConversationEventsReader | null;
};

export class LangyConversationReadService {
  static create(deps: LangyConversationReadOptions): LangyConversationReadService {
    return new LangyConversationReadService(deps);
  }

  private constructor(private readonly deps: LangyConversationReadOptions) {}

  /**
   * The visibility read, tolerant of the DISPATCH window: a just-accepted
   * create has a pending handoff before its projection row lands, so "missing
   * row + pending handoff" means NOT YET, retried briefly rather than reported as absent.
   */
  private async findVisibleToleratingDispatchLag({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }) {
    for (let attempt = 0; attempt <= DISPATCH_LAG_ATTEMPTS; attempt++) {
      const row = await this.deps.repository.tryFindVisibleById({
        id,
        projectId,
        userId,
      });
      if (row) {
        return row;
      }

      // Re-asked every beat, not once up front: the handoff row lands on the
      // same dispatch we are waiting for, so "no handoff yet" early on means
      // "too soon to tell", not "no such conversation".
      const handoff = await this.deps.repository
        .tryFindPendingHandoff({ projectId, conversationId: id })
        .catch(() => null);
      if (!handoff && attempt >= DISPATCH_HANDOFF_GRACE_ATTEMPTS) {
        return null;
      }

      if (attempt === DISPATCH_LAG_ATTEMPTS) {
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, DISPATCH_LAG_RETRY_MS));
    }

    return null;
  }

  /**
   * A conversation the caller may see; THROWS `LangyConversationNotFoundError`
   * rather than returning null, since the old null conflated "doesn't exist",
   * "not visible" and "projection not written yet" — the last one hid a real bug.
   */
  async getById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ConversationDetail> {
    const row = await this.findVisibleToleratingDispatchLag({
      id,
      projectId,
      userId,
    });
    if (!row) {
      throw new LangyConversationNotFoundError(id);
    }

    return {
      ...toListItem(row, userId),
      status: row.status,
      currentTurnId: row.currentTurnId,
      lastError: row.lastError,
      lastModel: row.lastModel,
      eventCursor: row.eventCursor ?? null,
    };
  }

  /**
   * The conversation's durable TURN events after a cursor (ADR-059 §2/§3),
   * authorized like `getById`, restricted to the TURN vocabulary so no
   * server-only spine field (`runToken`, handoff tokens) ever reaches the wire.
   */
  async getEventsAfter({
    projectId,
    conversationId,
    userId,
    after,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
    after: LangyEventCursor;
  }): Promise<{
    events: LangyConversationTurnWireEvent[];
    /** Position of the last returned event; `after` when the tail is empty. */
    cursor: LangyEventCursor;
    /** True when the tail was cut at the ceiling — fetch again from `cursor`. */
    truncated: boolean;
  }> {
    const visible = await this.findVisibleToleratingDispatchLag({
      id: conversationId,
      projectId,
      userId,
    });
    if (!visible) {
      throw new LangyConversationNotFoundError(conversationId);
    }

    // No event store configured (event sourcing disabled) means there are no
    // durable events at all — an empty tail is the honest answer.
    if (!this.deps.events) {
      return { events: [], cursor: after, truncated: false };
    }

    const all = await this.deps.events.getEventsOccurredSince(
      conversationId,
      { tenantId: createTenantId(projectId) },
      "langy_conversation",
      Math.max(0, after.acceptedAt - REHYDRATION_WINDOW_MS),
    );

    const turnTypes: readonly string[] = LANGY_CONVERSATION_TURN_EVENT_TYPES;
    const tail = all.filter(
      (event) => turnTypes.includes(event.type) && !cursorHasReachedEvent(after, event),
    );

    const truncated = tail.length > CONVERSATION_EVENT_TAIL_LIMIT;
    if (truncated) {
      conversationServiceLogger.warn(
        { projectId, conversationId, tailLength: tail.length },
        "Langy event tail exceeded the response ceiling — serving a truncated page",
      );
    }

    const page = truncated ? tail.slice(0, CONVERSATION_EVENT_TAIL_LIMIT) : tail;

    const events = page.map((event) =>
      langyConversationTurnEventSchema.parse({
        id: event.id,
        createdAt: event.createdAt,
        occurredAt: event.occurredAt,
        type: event.type,
        data: event.data,
      }),
    );

    const last = events.at(-1);

    return {
      events,
      cursor: last ? { acceptedAt: last.createdAt, eventId: last.id } : after,
      truncated,
    };
  }

  /**
   * The developer's own machine in one conversation, off the durable record
   * (ADR-129): every card it raised in order, and whether it's connected now.
   * The live stream can't answer either for an adopted tab.
   */
  async getLocalRecord({
    projectId,
    conversationId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<LangyLocalRecord> {
    const visible = await this.findVisibleToleratingDispatchLag({
      id: conversationId,
      projectId,
      userId,
    });
    if (!visible) {
      throw new LangyConversationNotFoundError(conversationId);
    }

    if (!this.deps.events) {
      return { waits: [], workspaceConnected: false };
    }

    const all = await this.deps.events.getEventsOccurredSince(
      conversationId,
      { tenantId: createTenantId(projectId) },
      "langy_conversation",
      0,
    );

    return {
      waits: recordWaitsOf(foldWaitTurns(all)),
      workspaceConnected: lastWorkspaceConnection(all),
    };
  }

  /**
   * `getById`, but absence is an answer, not an error — for callers that
   * genuinely tolerate "no fold yet" (the chat route's busy-guard). Every
   * other caller should use `getById` and let the domain error travel.
   */
  async tryFindByIdVisible({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ConversationDetail | null> {
    try {
      return await this.getById({ id, projectId, userId });
    } catch (error) {
      if (LangyConversationNotFoundError.is(error)) {
        return null;
      }

      throw error;
    }
  }

  async getAll({
    projectId,
    userId,
    limit = 50,
  }: {
    projectId: string;
    userId: string;
    limit?: number;
  }): Promise<ConversationListItem[]> {
    const rows = await this.deps.repository.findAllForUser({
      projectId,
      userId,
      limit,
    });

    return rows.map((r) => toListItem(r, userId));
  }

  /**
   * Keyset-paginated recent conversations. The repository receives one
   * look-ahead row so this layer can expose an opaque next cursor without a
   * separate count query.
   */
  async getPage({
    projectId,
    userId,
    limit = 30,
    cursor,
    query,
  }: {
    projectId: string;
    userId: string;
    limit?: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<ConversationListPage> {
    const normalizedQuery = query?.trim() || undefined;
    const rows = await this.deps.repository.findAllForUser({
      projectId,
      userId,
      limit: limit + 1,
      ...(cursor ? { cursor } : {}),
      ...(normalizedQuery ? { query: normalizedQuery } : {}),
    });
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows.at(-1);
    const rawCursorActivity =
      last?.cursorActivityAtMs === undefined
        ? (last?.lastActivityAtMs ?? null)
        : last.cursorActivityAtMs;

    return {
      items: pageRows.map((row) => toListItem(row, userId)),
      nextCursor: hasMore && last ? { lastActivityAtMs: rawCursorActivity, id: last.id } : null,
    };
  }

  /**
   * Resolves the conversation id for a chat turn without writing (the
   * aggregate is created by the first `message_recorded`). With
   * `adoptUnknownId`, an unknown id is ADOPTED rather than minted, so a scenario run's fixed `threadId` gets one stable conversation across turns.
   */
}
