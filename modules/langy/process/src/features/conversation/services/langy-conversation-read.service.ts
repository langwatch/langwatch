import {
  createTenantId,
  REHYDRATION_WINDOW_MS,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_EVENT_TYPES,
  LANGY_CONVERSATION_TURN_EVENT_TYPES,
  type LangyConversationTurnData,
  makeConversationTurnKey,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  type LangyLocalRecord,
  langyConversationTurnEventSchema,
  LangyConversationNotFoundError,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangyConversationListCursor,
  LangyConversationRepository,
} from "../../../repositories/langy-conversation-projection.repository.ts";
import {
  foldWaitTurns,
  lastWorkspaceConnection,
  recordWaitsOf,
  toListItem,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationListPage,
} from "../../../rules/langy-conversation-shape.rules.ts";
import {
  pickLatestControlRequest,
  type LatestControlRequestReading,
} from "../../../rules/langy-local-control-request-state.rules.ts";
import type { LangyConversationProcessingEvent } from "../../../eventing/langy-conversation-state.projection.ts";
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
 * How far back the visibility-evidence read looks — the only events that can
 * answer "is a create in flight for this caller right now?" are the ones a
 * create in flight just wrote. A create still in the dispatch window is at
 * most the dispatch budget old, so a lower bound generously past that catches
 * every in-flight create while bounding the read: an unbounded scan let a long
 * FOREIGN conversation cost more than an absent id — the very timing signal
 * this read exists not to emit (CWE-208). An old conversation's
 * owner-establishing event falls outside the window, so the read finds no
 * owner and gives up at the grace, exactly as an absent id does.
 */
const DISPATCH_EVIDENCE_WINDOW_MS = 5 * 60 * 1000;
/**
 * How many attempts may pass with NO evidence that waiting can help before we
 * conclude the id is simply unknown. Cannot be zero: the evidence — the
 * aggregate's events — is written by the very dispatch we are waiting on
 * (commands are queued, so the append trails the accept), so a read that
 * arrives before it lands finds nothing. It is also the SAME exit for absent,
 * foreign and archived ids alike — and for a reader outage — so an id nobody
 * may see never answers on a different clock than an id that does not exist.
 */
const DISPATCH_EVIDENCE_GRACE_ATTEMPTS = 3;

const conversationServiceLogger = createLogger("langwatch:langy:conversation-service");

/**
 * Whether this caller will see the conversation's projection row once the fold
 * lands it, decided from the raw event log by the fold's own rules: the owner
 * is named first-writer-wins by a started, forked or message_recorded event
 * (the last because a lazily created conversation's first message owns it), the
 * latest metadata word decides shared, and an archive is terminal (there is no
 * unarchive). message_imported carries no userId and never sets ownership,
 * exactly like the fold. Only meaningful for a NON-EMPTY log; an empty one says
 * nothing about whether the conversation exists.
 */
function eventLogSaysVisible(
  events: readonly LangyConversationProcessingEvent[],
  userId: string,
): boolean {
  let owner: string | null = null;
  let isShared = false;
  for (const event of events) {
    if (
      event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_STARTED ||
      event.type === LANGY_CONVERSATION_EVENT_TYPES.CONVERSATION_FORKED ||
      event.type === LANGY_CONVERSATION_EVENT_TYPES.MESSAGE_RECORDED
    ) {
      owner ??= event.data.userId;
    } else if (event.type === LANGY_CONVERSATION_EVENT_TYPES.METADATA_UPDATED) {
      isShared = event.data.isShared ?? isShared;
    } else if (event.type === LANGY_CONVERSATION_EVENT_TYPES.ARCHIVED) {
      return false;
    }
  }
  return owner === userId || isShared;
}

/**
 * Reading a conversation back: one by id, the event tail after a cursor, the local-control
 * record, and the sidebar's list and page. Every read tolerates the dispatch window, where an
 * admitted send has a turn receipt before its projection row lands.
 */
type LangyConversationReadOptions = {
  repository: LangyConversationRepository;
  events: LangyConversationEventsReader | null;
  turnStates: StateProjectionStore<LangyConversationTurnData> | null;
};

export class LangyConversationReadService {
  static create(deps: LangyConversationReadOptions): LangyConversationReadService {
    return new LangyConversationReadService(deps);
  }

  private constructor(private readonly deps: LangyConversationReadOptions) {}

  /**
   * The visibility read, tolerant of the DISPATCH window. A conversation's
   * projection row is written by an asynchronous fold, so every read of a
   * brand-new conversation can run before the row lands. Whether a miss is
   * worth waiting out is decided from the canonical event log
   * (`dispatchInFlightEvidence`): a caller the log says will see the row once
   * it lands waits out the FULL budget; every other miss — absent, foreign and
   * archived alike — gives up at the same short grace, so timing never becomes
   * an existence oracle across users. The evidence only ever EXTENDS the wait:
   * the answer always comes from the retried visibility read.
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
    let waitOutFullBudget = false;
    for (let attempt = 0; attempt <= DISPATCH_LAG_ATTEMPTS; attempt++) {
      const row = await this.deps.repository
        .getVisibleById({ id, projectId, userId })
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "langy_conversation_not_found") {
            return null;
          }
          throw error;
        });
      if (row) {
        return row;
      }

      // Short-circuits once the log has said wait: evidence is not re-read
      // every beat after, only the projection is. Re-asked until then because
      // commands are queued — the event append can trail the accept by a beat,
      // so "nothing on the log yet" early on means "too soon to tell".
      waitOutFullBudget =
        waitOutFullBudget || (await this.dispatchInFlightEvidence({ id, projectId, userId }));
      if (!waitOutFullBudget && attempt >= DISPATCH_EVIDENCE_GRACE_ATTEMPTS) {
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
   * Whether a projection miss is worth waiting out — the answer to "will this
   * caller's visibility read succeed once the fold catches up?". The ONLY
   * source is the canonical event log, the very record the projection is
   * folded FROM: owned-or-shared and not archived means the visible row WILL
   * land (`eventLogSaysVisible`), anything else means waiting cannot help. An
   * EMPTY log is "no evidence", not "no conversation". No reader and a failed
   * read both answer "no evidence", never a guess: only evidence that
   * ESTABLISHES the caller's visibility may extend the wait, or the window
   * itself becomes a timing signal for a foreign caller (CWE-208).
   */
  private async dispatchInFlightEvidence({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    if (!this.deps.events) return false;
    try {
      const events = await this.deps.events.getEventsOccurredSince({
        aggregateId: id,
        context: { tenantId: createTenantId(projectId) },
        aggregateType: "langy_conversation",
        occurredAtFromMs: Math.max(0, Date.now() - DISPATCH_EVIDENCE_WINDOW_MS),
      });
      return events.length > 0 && eventLogSaysVisible(events, userId);
    } catch (error) {
      conversationServiceLogger.warn(
        {
          projectId,
          conversationId: id,
          error: error instanceof Error ? error.message : String(error),
        },
        "Event-log evidence read failed during the dispatch window — treating as no evidence (short grace)",
      );
      return false;
    }
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

    const all = await this.deps.events.getEventsOccurredSince({
      aggregateId: conversationId,
      context: { tenantId: createTenantId(projectId) },
      aggregateType: "langy_conversation",
      occurredAtFromMs: Math.max(0, after.acceptedAt - REHYDRATION_WINDOW_MS),
    });

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

  /** One turn's projected state, authorized like `getById`; empty until its first event folds. */
  async findTurn({
    projectId,
    conversationId,
    turnId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<LangyConversationTurnData[]> {
    const visible = await this.findVisibleToleratingDispatchLag({
      id: conversationId,
      projectId,
      userId,
    });
    if (!visible) {
      throw new LangyConversationNotFoundError(conversationId);
    }
    if (!this.deps.turnStates) {
      return [];
    }

    const read = await this.deps.turnStates.get(makeConversationTurnKey(conversationId, turnId), {
      tenantId: createTenantId(projectId),
      aggregateId: conversationId,
    });
    return read.kind === "folded" ? [read.projection.state] : [];
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

    const all = await this.deps.events.getEventsOccurredSince({
      aggregateId: conversationId,
      context: { tenantId: createTenantId(projectId) },
      aggregateType: "langy_conversation",
      occurredAtFromMs: 0,
    });

    return {
      waits: recordWaitsOf(foldWaitTurns(all)),
      workspaceConnected: lastWorkspaceConnection(all),
    };
  }

  /**
   * The latest request to share a folder this conversation recorded, and whether a folder
   * connected through it (ADR-129). The open request lives in Redis only while a terminal can
   * approve it; this says why there is nothing to approve. The caller proves the conversation.
   */
  async getLatestLocalControlRequest({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<LatestControlRequestReading> {
    if (!this.deps.events) return { kind: "no_request_recorded" };
    const all = await this.deps.events.getEventsOccurredSince({
      aggregateId: conversationId,
      context: { tenantId: createTenantId(projectId) },
      aggregateType: "langy_conversation",
      occurredAtFromMs: 0,
    });
    return pickLatestControlRequest(all);
  }

  /**
   * `getById`, but absence is an answer, not an error — for callers that
   * genuinely tolerate "no fold yet" (the chat route's busy-guard). Every
   * other caller should use `getById` and let the domain error travel.
   */
  async findByIdVisible({
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

  /** Resolve conversation id for a chat turn without writing (created by first message_recorded).
   * adoptUnknownId: unknown id ADOPTED rather than minted, for scenario run stability. */
}
