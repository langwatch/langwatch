import type { CommandEnvelope } from "@langwatch/eventing";
import { createTenantId, REHYDRATION_WINDOW_MS, type TenantId } from "@langwatch/eventing";
import type { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type {
  LangyAgentRespondedEventData,
  LangyAgentResponseFailedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyConversationArchivedEventData,
  LangyConversationForkedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationStartedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyMessageImportedEventData,
  LangyMessagePart,
  LangyMessageRecordedEventData,
  LangyMessageRole,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "@langwatch/langy-contract";
import {
  cursorHasReachedEvent,
  LANGY_CONVERSATION_STATUS,
  LANGY_CONVERSATION_TURN_EVENT_TYPES,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  langyConversationTurnEventSchema,
  langyJsonValueSchema,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { LangyTurnErrors } from "./langy-turn-errors.errors";
import { mintRunToken } from "../ports/langy-frame-auth.port";
import type { LangyConversationProcessingEvent } from "./langy-conversation.events";
import { LANGY_ID_RESOURCES } from "../ports/langy-ids.port";
import {
  LangyConversationIdUnadoptableError,
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "@langwatch/langy-contract";
import { LangyFinalPartsService, type LangyFinalToolCall } from "./langy-final-parts.service";
import type {
  LangyConversationListCursor,
  LangyConversationRepository,
  LangyConversationRow,
} from "../repositories/langy-conversation-projection.repository";
import {
  type LangyMessageRepository,
  type LangyMessageRow,
  NullLangyMessageRepository,
} from "../repositories/langy-message.repository";
import type { LangyTurnOrderReader, LangyTurnSegment } from "../streaming/langy-turn-order";

export type { LangyConversationRepository as LangyConversationReadRepository } from "../repositories/langy-conversation-projection.repository";

/**
 * Narrow read port over the canonical event log (ADR-059), satisfied by
 * `EventStore.getEventsOccurredSince`. The explicit lower bound lets
 * ClickHouse prune weekly partitions instead of cold-scanning the history.
 */
export interface LangyConversationEventsReader {
  getEventsOccurredSince(
    aggregateId: string,
    context: { tenantId: TenantId },
    aggregateType: "langy_conversation",
    occurredAtFromMs: number,
  ): Promise<readonly LangyConversationProcessingEvent[]>;
}

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

/** List-item shape the sidebar renders. Named for the domain, not the column. */
export type ConversationListItem = {
  id: string;
  title: string | null;
  isShared: boolean;
  isOwn: boolean;
  lastActivityAt: Date;
  messageCount: number;
};

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

/** Command dispatchers injected from the event-sourcing pipeline registry. */
type Dispatch<T> = (data: T & CommandEnvelope) => Promise<void>;

export interface LangyConversationCommands {
  createConversation: Dispatch<LangyConversationStartedEventData>;
  forkConversation: Dispatch<LangyConversationForkedEventData>;
  recordMessage: Dispatch<LangyMessageRecordedEventData>;
  importMessage: Dispatch<LangyMessageImportedEventData>;
  acceptAgentTurn: Dispatch<
    LangyAgentTurnAcceptedEventData & {
      conversationStart?: Omit<LangyConversationStartedEventData, "conversationId">;
      userMessage?: Omit<LangyMessageRecordedEventData, "conversationId">;
      consumeHandoffTurnId?: string;
    }
  >;
  initiateToolCall: Dispatch<LangyToolCallInitiatedEventData>;
  succeedToolCall: Dispatch<LangyToolCallSucceededEventData>;
  failToolCall: Dispatch<LangyToolCallFailedEventData>;
  updatePlan: Dispatch<LangyPlanUpdatedEventData>;
  failAgentResponse: Dispatch<LangyAgentResponseFailedEventData>;
  recordAgentResponse: Dispatch<LangyAgentRespondedEventData>;
  archiveConversation: Dispatch<LangyConversationArchivedEventData>;
  updateConversationMetadata: Dispatch<LangyConversationMetadataUpdatedEventData>;
  recordTurnHandoff: Dispatch<LangyConversationHandoffPendingEventData>;
  consumeTurnHandoff: Dispatch<LangyConversationHandoffConsumedEventData>;
  generateConversationTitle: Dispatch<LangyConversationTitleGeneratedEventData>;
}

export interface LangyConversationRuntime {
  now(): number;
  generateId(resource: keyof typeof LANGY_ID_RESOURCES): string;
  createTurnId(): string;
}

const defaultRuntime: LangyConversationRuntime = {
  now: () => Date.now(),
  generateId: (resource) => generate(LANGY_ID_RESOURCES[resource]).toString(),
  createTurnId: () => crypto.randomUUID(),
};

/**
 * Shape gate for ADOPTED conversation ids (`ensureConversation` with
 * `adoptUnknownId`): caller-chosen ids become aggregate keys, so they must fit
 * our KSUID-prefixed alphabet — a scenario `threadId` fits.
 */
export const ADOPTABLE_CONVERSATION_ID = /^[A-Za-z0-9_-]{6,120}$/;

/**
 * Langy application service. Reads come from the Postgres operational
 * projection; writes remain event-sourcing commands.
 */
export class LangyConversationService {
  constructor(
    private readonly repository: LangyConversationRepository,
    private readonly commands: LangyConversationCommands,
    private readonly messages: LangyMessageRepository = new NullLangyMessageRepository(),
    private readonly events: LangyConversationEventsReader | null = null,
    private readonly finalParts: LangyFinalPartsService = LangyFinalPartsService.create(),
    private readonly runtime: LangyConversationRuntime = defaultRuntime,
    private readonly turnOrder: LangyTurnOrderReader | null = null,
  ) {}

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
      const row = await this.repository.tryFindVisibleById({
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
      const handoff = await this.repository
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
      ...LangyConversationService.toListItem(row, userId),
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
    if (!this.events) {
      return { events: [], cursor: after, truncated: false };
    }

    const all = await this.events.getEventsOccurredSince(
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
    const rows = await this.repository.findAllForUser({
      projectId,
      userId,
      limit,
    });

    return rows.map((r) => LangyConversationService.toListItem(r, userId));
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
    const rows = await this.repository.findAllForUser({
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
      items: pageRows.map((row) => LangyConversationService.toListItem(row, userId)),
      nextCursor: hasMore && last ? { lastActivityAtMs: rawCursorActivity, id: last.id } : null,
    };
  }

  /**
   * Resolves the conversation id for a chat turn without writing (the
   * aggregate is created by the first `message_recorded`). With
   * `adoptUnknownId`, an unknown id is ADOPTED rather than minted, so a scenario run's fixed `threadId` gets one stable conversation across turns.
   */
  async ensureConversation({
    projectId,
    userId,
    conversationId,
    adoptUnknownId = false,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string | null;
    adoptUnknownId?: boolean;
  }): Promise<{ id: string; isNew: boolean }> {
    if (!conversationId) {
      return { id: this.runtime.generateId("conversation"), isNew: true };
    }

    // Resolve straight from the repo (not the share-aware getById): visibility
    // of a shared conversation does not grant continuation rights.
    const ownership = await this.repository.findOwnership({
      id: conversationId,
      projectId,
      userId,
    });
    if (ownership === "owned") {
      return { id: conversationId, isNew: false };
    }

    if (ownership === "other") {
      throw new LangyConversationNotOwnedError(conversationId);
    }

    if (adoptUnknownId) {
      return LangyConversationService.adoptConversationId(conversationId, ownership);
    }

    // Archived / never existed: mint a fresh id — a stale id is legitimate
    // client state, unlike one owned by another user.
    return { id: this.runtime.generateId("conversation"), isNew: true };
  }

  /**
   * Explicitly creates a conversation (`conversation_started`), seeding the
   * owner and optional title. Idempotent on the conversation
   * (`${tenantId}:${conversationId}:created`), so a retry collapses to one event.
   */
  async createConversation({
    projectId,
    userId,
    conversationId,
    title,
    runToken,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string;
    title?: string | null;
    /**
     * The per-conversation runToken (`streaming/langyFrameAuth.ts`): stashed in
     * the turn handoff since dispatch reads it from there, not operational
     * state, which may not have consumed the creation event yet.
     */
    runToken?: string;
  }): Promise<{ id: string }> {
    const resolvedConversationId = conversationId ?? this.runtime.generateId("conversation");
    await this.commands.createConversation({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId: resolvedConversationId,
      userId,
      title: title ?? null,
      runToken: runToken ?? mintRunToken(),
    });

    return { id: resolvedConversationId };
  }

  /**
   * Branches a visible conversation into a fresh one owned by the caller.
   * Source projection is read once at command time; the new aggregate is
   * self-contained, so replay never needs the source to still exist.
   */
  async forkById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<{
    conversation: ConversationDetail;
    messages: LangyMessageRow[];
  }> {
    const source = await this.getById({ id, projectId, userId });
    const sourceMessages = await this.messages.findAllByConversation({
      conversationId: id,
      projectId,
    });

    const conversationId = this.runtime.generateId("conversation");
    const title = `${source.title?.trim() || "Untitled chat"} (fork)`;
    const startedAt = this.runtime.now();

    await this.commands.forkConversation({
      tenantId: projectId,
      occurredAt: startedAt,
      conversationId,
      sourceConversationId: id,
      userId,
      title,
      runToken: mintRunToken(),
    });

    const importedMessages: LangyMessageRow[] = [];
    for (const [index, sourceMessage] of sourceMessages.entries()) {
      const messageId = this.runtime.generateId("message");
      const occurredAt = startedAt + index + 1;
      await this.commands.importMessage({
        tenantId: projectId,
        occurredAt,
        conversationId,
        sourceConversationId: id,
        sourceMessageId: sourceMessage.id,
        messageId,
        role: sourceMessage.role,
        parts: sourceMessage.parts,
      });
      importedMessages.push({
        id: messageId,
        role: sourceMessage.role,
        parts: sourceMessage.parts,
        createdAt: new Date(occurredAt),
      });
    }

    const lastActivityAt = new Date(startedAt + sourceMessages.length);

    return {
      conversation: {
        id: conversationId,
        title,
        isShared: false,
        isOwn: true,
        lastActivityAt,
        messageCount: importedMessages.length,
        status: LANGY_CONVERSATION_STATUS.IDLE,
        // An import runs no turn — there is nothing in flight to stop.
        currentTurnId: null,
        lastError: null,
        // No turn ran here yet, so the fork carries no model of its own and
        // the composer falls back to the resolved default.
        lastModel: null,
        // The fork's projection has not landed yet, so there is no snapshot
        // position to seed from — the client folds from the start.
        eventCursor: null,
      },
      messages: importedMessages,
    };
  }

  /**
   * Per-conversation `runToken` (`streaming/langyFrameAuth.ts`), or null when
   * none exists. READ ONLY server-side — the worker-provisioning path injects
   * it and the relay verifies stream frames with it, same posture as the handoff token.
   */
  async tryGetRunToken({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null> {
    return this.repository.tryFindRunToken({ projectId, conversationId });
  }

  /**
   * Records the user's message: one `message_recorded` event feeds both
   * conversation state (count/activity/owner/title) and the operational
   * message projection, replacing the old separate writes.
   */
  async recordUserMessage({
    projectId,
    conversationId,
    userId,
    parts,
    title,
    role = "user",
    messageId,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    title?: string | null;
    role?: LangyMessageRole;
    /** Stable logical-send identity supplied by the turn orchestrator. */
    messageId?: string;
  }): Promise<{ messageId: string }> {
    const resolvedMessageId = messageId ?? this.runtime.generateId("message");
    await this.commands.recordMessage({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      userId,
      messageId: resolvedMessageId,
      role,
      parts,
      title: title ?? null,
    });

    return { messageId: resolvedMessageId };
  }

  /**
   * Durably accepts an agent turn; returns the turnId to correlate finalize.
   * Accepts an optional turnId so a caller can stash the spawn handoff
   * (ADR-044) before `agent_turn_accepted` dispatches, closing an outbox race.
   */
  async acceptTurn({
    projectId,
    conversationId,
    turnId,
    questionParts,
    model,
    conversationStart,
    userMessage,
    consumeHandoffTurnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId?: string;
    /** The user's question that opened the turn — folded into the turn document. */
    questionParts?: LangyMessagePart[];
    /** The model this turn runs on — the fold keeps the latest as `LastModel`. */
    model?: string;
    /** Optional first-event marker, committed atomically before acceptance. */
    conversationStart?: Omit<LangyConversationStartedEventData, "conversationId">;
    /** Optional user message, committed atomically before acceptance. */
    userMessage?: Omit<LangyMessageRecordedEventData, "conversationId">;
    /** Prior checkpoint-producing turn consumed atomically with this start. */
    consumeHandoffTurnId?: string;
  }): Promise<{ turnId: string }> {
    const resolvedTurnId = turnId ?? this.runtime.createTurnId();
    await this.commands.acceptAgentTurn({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId: resolvedTurnId,
      ...(questionParts !== undefined ? { questionParts } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(conversationStart ? { conversationStart } : {}),
      ...(userMessage ? { userMessage } : {}),
      ...(consumeHandoffTurnId ? { consumeHandoffTurnId } : {}),
    });

    return { turnId: resolvedTurnId };
  }

  /**
   * Record a durable turn milestone: a tool the agent began running. Transient
   * progress ticks stay ephemeral (Redis); a tool call is a meaningful audit of
   * what the agent did, so it is a durable event (ADR-044).
   */
  async recordToolCallStarted({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    toolName,
    command,
    input,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    command?: string;
    input?: unknown;
  }): Promise<void> {
    const jsonInput = input === undefined ? undefined : langyJsonValueSchema.parse(input);
    await this.commands.initiateToolCall({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(jsonInput !== undefined ? { input: jsonInput } : {}),
    });
  }

  /**
   * Records a tool call's terminal: `isError` routes to `tool_call_failed`
   * (carrying `errorText`), otherwise `tool_call_succeeded`. Both share the
   * `tool-done:<toolCallId>` idempotency slot, so the first terminal wins.
   */
  async recordToolCallCompleted({
    projectId,
    conversationId,
    turnId,
    toolCallId,
    toolName,
    isError,
    command,
    input,
    durationMs,
    errorText,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    toolCallId: string;
    toolName: string;
    isError?: boolean;
    command?: string;
    input?: unknown;
    durationMs?: number;
    errorText?: string;
  }): Promise<void> {
    const jsonInput = input === undefined ? undefined : langyJsonValueSchema.parse(input);
    const shared = {
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(jsonInput !== undefined ? { input: jsonInput } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    if (isError) {
      await this.commands.failToolCall({
        ...shared,
        ...(errorText !== undefined ? { errorText } : {}),
      });
    } else {
      await this.commands.succeedToolCall(shared);
    }
  }

  /**
   * Records a plan snapshot (a settled `todowrite`). Last-write-wins on the
   * turn fold, dispatched at-most-once per snapshot since the relay already
   * drops redelivered frames by nonce.
   */
  async recordPlanUpdated({
    projectId,
    conversationId,
    turnId,
    items,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    items: Array<{ content: string; status: string }>;
  }): Promise<void> {
    await this.commands.updatePlan({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      items,
    });
  }

  /**
   * Terminal failure for a response with nothing to carry (stalled/orphaned,
   * drained by the liveness sweep or on shutdown). Emits
   * `agent_response_failed`, clearing CurrentTurnId and surfacing the error.
   */
  async failTurn({
    projectId,
    conversationId,
    turnId,
    error,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    error: string;
  }): Promise<void> {
    await this.commands.failAgentResponse({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      error,
    });
  }

  /**
   * Ingests a turn result posted directly over HTTP — the independent,
   * at-least-once path used when the relay's NDJSON stream dropped.
   * Idempotent on `turnId`; also verifies the turn triple was really accepted, since this route has no HMAC, only the shared bearer.
   */
  async turnExists({
    projectId,
    conversationId,
    turnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.repository.turnExists({ projectId, conversationId, turnId });
  }

  async ingestAgentTurnResult({
    projectId,
    conversationId,
    turnId,
    status,
    text,
    toolCalls,
    errorCode,
    errorCause,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    status: "completed" | "failed";
    text?: string;
    toolCalls?: LangyFinalToolCall[];
    errorCode?: string;
    /**
     * The failure's typed cause chain when known (deserialized at the
     * boundary) — classified here so `LastError` names the REAL failure (e.g.
     * gateway's no_provider_configured) with the chain as reasons.
     */
    errorCause?: HandledError;
  }): Promise<void> {
    if (status === "failed") {
      await this.failTurn({
        projectId,
        conversationId,
        turnId,
        error: LangyTurnErrors.serialize(
          LangyTurnErrors.fromErrorFrame({
            code: errorCode ?? "agent error",
            ...(errorCause !== undefined ? { cause: errorCause } : {}),
          }),
        ),
      });

      return;
    }

    const order = await this.readTurnOrder({ conversationId, turnId });
    await this.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: this.finalParts.build({
        text: text ?? "",
        toolCalls,
        ...(order.length > 0 ? { order } : {}),
      }),
      outcome: "completed",
    });
  }

  /**
   * The turn's own account of what happened, folded off its live stream. Read
   * here since two paths finalize a turn (relay + agent HTTP post) and
   * whichever lands first wins. Best effort: a failed read still records what it can rather than failing an otherwise-complete finalize.
   */
  private async readTurnOrder(at: {
    conversationId: string;
    turnId: string;
  }): Promise<LangyTurnSegment[]> {
    if (!this.turnOrder) {
      return [];
    }

    try {
      return await this.turnOrder.readTurnOrder(at);
    } catch (error) {
      conversationServiceLogger.warn(
        { ...at, error },
        "could not read a turn's order; recording its calls before its reply",
      );

      return [];
    }
  }

  /**
   * The pending shutdown-handoff for a conversation, or null (ADR-048). Read
   * from the fold; the token is opaque to the control plane.
   */
  async tryGetPendingHandoff({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null> {
    return this.repository.tryFindPendingHandoff({ projectId, conversationId });
  }

  /**
   * Persists an opaque worker-authored resume token left on pod termination
   * (ADR-048, `conversation_handoff_pending`). Clears CurrentTurnId and
   * stores the token for the next turn to resume from.
   */
  async recordTurnHandoff({
    projectId,
    conversationId,
    turnId,
    token,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    token: string;
  }): Promise<void> {
    await this.commands.recordTurnHandoff({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      token,
    });
  }

  /**
   * Clear a pending handoff once the next turn has threaded it to a fresh
   * worker (ADR-048): `conversation_handoff_consumed`. Idempotent on the turn,
   * so a double-consume collapses to one durable event.
   */
  async consumeHandoff({
    projectId,
    conversationId,
    turnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    await this.commands.consumeTurnHandoff({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
    });
  }

  /**
   * Finalizes an agent response (`agent_responded` carries the whole answer).
   * messageId is DERIVED from turnId, never minted fresh: finalize has two
   * independent writers (relay + durable POST), and a fresh KSUID per call made the reply render twice after reload.
   */
  async finalizeTurn({
    projectId,
    conversationId,
    turnId,
    parts,
    outcome = "completed",
    error,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    parts: LangyMessagePart[];
    // `stopped` is a user-initiated stop carrying the partial answer (ADR-078);
    // it shares agent_responded's turn-terminal slot with completed/failed, so a
    // stop racing a natural finish collapses to exactly one terminal.
    outcome?: "completed" | "failed" | "stopped";
    error?: string | null;
  }): Promise<{ messageId: string }> {
    const messageId = LangyConversationService.turnMessageId(turnId);
    await this.commands.recordAgentResponse({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId,
      turnId,
      messageId,
      role: "assistant",
      parts,
      outcome,
      error: error ?? null,
    });

    return { messageId };
  }

  async deleteById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<boolean> {
    const conv = await this.tryFindByIdVisible({ id, projectId, userId });
    // Only the owner may archive — a shared conversation is visible, not deletable.
    if (!conv?.isOwn) {
      return false;
    }

    await this.commands.archiveConversation({
      tenantId: projectId,
      occurredAt: this.runtime.now(),
      conversationId: id,
    });

    return true;
  }

  async updateById({
    id,
    projectId,
    userId,
    title,
    isShared,
  }: {
    id: string;
    projectId: string;
    userId: string;
    title?: string | null;
    isShared?: boolean;
  }): Promise<ConversationDetail> {
    const conv = await this.tryFindByIdVisible({ id, projectId, userId });
    if (!conv?.isOwn) {
      // A shared conversation is visible but not editable by a non-owner; we do
      // not leak that distinction — both read as "not found" to the caller.
      throw new LangyConversationNotFoundError(id);
    }

    if (title === undefined && isShared === undefined) {
      return conv;
    }

    await this.commands.updateConversationMetadata({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId: id,
      ...(title !== undefined ? { title } : {}),
      ...(isShared !== undefined ? { isShared, sharedById: isShared ? userId : null } : {}),
    });

    // Optimistic echo: the fold is written asynchronously, so return the
    // caller's intended state rather than a possibly-stale re-read.
    return {
      ...conv,
      title: title !== undefined ? title : conv.title,
      isShared: isShared !== undefined ? isShared : conv.isShared,
    };
  }

  async clearAllForUser({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<{ deletedCount: number }> {
    const ids = await this.repository.findActiveOwnedIds({ projectId, userId });
    const now = this.runtime.now();
    await Promise.all(
      ids.map((conversationId) =>
        this.commands.archiveConversation({
          tenantId: projectId,
          occurredAt: now,
          conversationId,
        }),
      ),
    );

    return { deletedCount: ids.length };
  }

  static create(
    commands: LangyConversationCommands,
    repository: LangyConversationRepository,
    messages?: LangyMessageRepository,
    events?: LangyConversationEventsReader | null,
    finalParts?: LangyFinalPartsService,
    runtime?: LangyConversationRuntime,
    turnOrder?: LangyTurnOrderReader | null,
  ): LangyConversationService {
    return new LangyConversationService(
      repository,
      commands,
      messages,
      events,
      finalParts,
      runtime,
      turnOrder,
    );
  }

  /**
   * Adopts a caller-chosen id as a NEW conversation, or refuses loudly — the
   * id becomes an aggregate key, gated before anything is written. Archived is
   * a refusal, not a resume: adopting would append to a closed aggregate.
   */
  private static adoptConversationId(
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
  private static turnMessageId(turnId: string): string {
    return `langymsg_turn-${turnId}`;
  }

  /**
   * Module-level (not a method) so the traced() proxy in presets.ts never wraps
   * it: it is sync and its results are spread/mapped — an async wrapper would
   * silently turn them into Promises.
   */
  private static toListItem(row: LangyConversationRow, userId: string): ConversationListItem {
    return {
      id: row.id,
      title: row.title,
      isShared: row.isShared,
      isOwn: row.userId === userId,
      lastActivityAt: new Date(row.lastActivityAtMs > 0 ? row.lastActivityAtMs : row.createdAtMs),
      messageCount: row.messageCount,
    };
  }
}
