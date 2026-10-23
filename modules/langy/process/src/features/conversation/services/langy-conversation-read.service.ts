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
import { nowInstant } from "@langwatch/time";

import type { LangyConversationProcessingEvent } from "../../../eventing/langy-conversation-state.projection.ts";
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
 * Lookback for the evidence read: well past the dispatch budget, so every in-flight
 * create is caught, yet bounded so a long FOREIGN conversation costs no more than an
 * absent id (no timing oracle, CWE-208). Older conversations exit at the grace.
 */
const DISPATCH_EVIDENCE_WINDOW_MS = 5 * 60 * 1000;
/**
 * No-evidence attempts before giving up. Non-zero because the queued append trails
 * the accept; one shared exit for absent, foreign, archived ids and reader outages,
 * so an invisible id never answers on a different clock than a missing one.
 */
const DISPATCH_EVIDENCE_GRACE_ATTEMPTS = 3;

const conversationServiceLogger = createLogger("langwatch:langy:conversation-service");

/**
 * Whether the caller will see the row once the fold lands it, by the fold's rules:
 * first started/forked/message_recorded names the owner (message_imported never does),
 * latest metadata decides shared, archive is terminal. Only meaningful for a NON-EMPTY log.
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
   * Visibility read tolerant of the async fold. Log evidence that the caller will see
   * the row extends the wait to the full budget; every other miss exits at one shared
   * grace (no existence oracle). The answer always comes from the retried read.
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
   * Whether a projection miss is worth waiting out, read from the event log the fold
   * consumes. Empty log, no reader, or a failed read all mean "no evidence": only
   * evidence ESTABLISHING visibility may extend the wait (else a CWE-208 timing signal).
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
        occurredAtFromMs: Math.max(0, nowInstant().epochMilliseconds - DISPATCH_EVIDENCE_WINDOW_MS),
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
