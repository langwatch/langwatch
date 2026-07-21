import { generate } from "@langwatch/ksuid";
import type { HandledError } from "@langwatch/handled-error";
import {
  langyAgentErrorFromErrorFrame,
  serializeLangyTurnError,
} from "~/server/app-layer/langy/execution/langy-turn-errors";
import { mintRunToken } from "~/server/app-layer/langy/streaming/langyFrameAuth";
import type { CommandEnvelope } from "~/server/event-sourcing/commands/commandEnvelope";
import type {
  LangyAgentRespondedEventData,
  LangyAgentResponseFailedEventData,
  LangyAgentTurnAcceptedEventData,
  LangyConversationArchivedEventData,
  LangyMessageRecordedEventData,
  LangyConversationForkedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationStartedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyMessageImportedEventData,
  LangyMessagePart,
  LangyMessageRole,
  LangyPlanUpdatedEventData,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "@langwatch/langy";
import { LANGY_CONVERSATION_STATUS, langyJsonValueSchema } from "@langwatch/langy";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "./errors";
import {
  buildFinalAssistantParts,
  type LangyFinalToolCall,
} from "./langy-final-parts";
import type {
  LangyConversationListCursor,
  LangyConversationRepository,
  LangyConversationRow,
} from "./repositories/langy-conversation.repository";
import {
  type LangyMessageRepository,
  type LangyMessageRow,
  NullLangyMessageRepository,
} from "./repositories/langy-message.repository";

export type { LangyConversationRepository as LangyConversationReadRepository } from "./repositories/langy-conversation.repository";

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
   * The turn in flight right now, or null when none is (`CurrentTurnId` on the
   * fold — set at `agent_turn_accepted`, cleared by the turn's terminal).
   *
   * The durable answer to "which turn would a Stop stop?" (ADR-058). A browser
   * tab only learns a turn id from its own send, so a turn it merely adopted —
   * another tab's, or one rejoined after a refresh — had no id to stop with.
   * The record has always known; nobody read it back.
   */
  currentTurnId: string | null;
  /**
   * Why the last turn failed, when it did (`agent_response_failed` sets it on the
   * fold). DURABLE, unlike the browser's `useChat` error — which is why a refresh
   * after a failed turn used to leave the user's question sitting there with no
   * answer and no explanation at all.
   */
  lastError: string | null;
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
      conversationStart?: Omit<
        LangyConversationStartedEventData,
        "conversationId"
      >;
      userMessage?: Omit<
        LangyMessageRecordedEventData,
        "conversationId"
      >;
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

function newConversationId(): string {
  return generate(KSUID_RESOURCES.LANGY_CONVERSATION).toString();
}

function newMessageId(): string {
  return generate(KSUID_RESOURCES.LANGY_MESSAGE).toString();
}

/**
 * The assistant message id for a turn — deterministic, so however many times a
 * turn's finalize lands (live relay + durable backup, retries), it is always
 * the SAME message and dedups on MessageId everywhere. Ordering is unaffected:
 * the messages read sorts by CreatedAt first (MessageId is only a tiebreak).
 */
function turnMessageId(turnId: string): string {
  return `langymsg_turn-${turnId}`;
}

/**
 * Module-level (not a method) so the traced() proxy in presets.ts never wraps
 * it: it is sync and its results are spread/mapped — an async wrapper would
 * silently turn them into Promises.
 */
function toListItem(
  row: LangyConversationRow,
  userId: string,
): ConversationListItem {
  return {
    id: row.id,
    title: row.title,
    isShared: row.isShared,
    isOwn: row.userId === userId,
    lastActivityAt: new Date(
      row.lastActivityAtMs > 0 ? row.lastActivityAtMs : row.createdAtMs,
    ),
    messageCount: row.messageCount,
  };
}

/**
 * Langy application service. Reads come from the Postgres operational
 * projection; writes remain event-sourcing commands.
 */
export class LangyConversationService {
  constructor(
    private readonly repository: LangyConversationRepository,
    private readonly commands: LangyConversationCommands,
    private readonly messages: LangyMessageRepository = new NullLangyMessageRepository(),
  ) {}

  /**
   * A conversation the caller may see.
   *
   * THROWS `LangyConversationNotFoundError` when there is no such conversation —
   * it does not return null, and that is the whole point of this method's shape.
   *
   * The old signature returned `null` for THREE different situations: the
   * conversation does not exist, the caller may not see it, and — the one that
   * hid — the conversation exists but its asynchronous projection has not been
   * written yet. Three call sites hand-rolled a 404 out of that ambiguous null, and so
   * the live-stream routes answered 404 on the first turn of every conversation,
   * because "not yet" and "never" were indistinguishable. Stream B never ran once.
   *
   * A repository saying "not found" when it means "not yet" is how a bug lives
   * for the lifetime of a feature. So the absence is now a NAMED error, and a
   * caller who wants to tolerate it has to say so out loud.
   *
   * Not-visible is reported as not-found ON PURPOSE: a conversation you may not
   * see must not be distinguishable from one that does not exist, or the error
   * itself becomes an existence oracle across users.
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
    const row = await this.repository.findVisibleById({
      id,
      projectId,
      userId,
    });
    if (!row) throw new LangyConversationNotFoundError(id);
    return {
      ...toListItem(row, userId),
      status: row.status,
      currentTurnId: row.currentTurnId,
      lastError: row.lastError,
    };
  }

  /**
   * `getById`, but absence is an answer rather than an error.
   *
   * For the callers that genuinely want to tolerate "there is no fold yet" — the
   * chat route's busy-guard, which asks "is a turn already running?" and for
   * which an unprojected conversation correctly means "no". Every OTHER caller
   * should use `getById` and let the domain error travel.
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
      if (LangyConversationNotFoundError.is(error)) return null;
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
      items: pageRows.map((row) => toListItem(row, userId)),
      nextCursor:
        hasMore && last
          ? { lastActivityAtMs: rawCursorActivity, id: last.id }
          : null,
    };
  }

  /**
   * Count the user's conversations touched since `since` (epoch ms) — the "N
   * new" pill. Deliberately derived from the already-bounded recent list rather
   * than a second ClickHouse read path: the pill only needs to distinguish
   * 0 / small-N, and the list is capped at 100. Kept in the service (not the
   * transport) so the count derivation lives behind the app layer.
   */
  async countSince({
    projectId,
    userId,
    since,
  }: {
    projectId: string;
    userId: string;
    since: number;
  }): Promise<number> {
    const items = await this.getAll({ projectId, userId, limit: 100 });
    return items.filter((item) => item.lastActivityAt.getTime() > since).length;
  }

  /**
   * Resolve the conversation id for a chat turn. Does NOT write — the aggregate
   * is created by the first `message_recorded`. Verifies ownership against the fold;
   * a stale/archived/unknown id yields a fresh conversation.
   */
  async ensureConversation({
    projectId,
    userId,
    conversationId,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string | null;
  }): Promise<{ id: string; isNew: boolean }> {
    if (conversationId) {
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
      // Archived / never existed: fall through and mint a fresh id — a stale id
      // is legitimate client state, unlike one owned by another user.
    }
    return { id: newConversationId(), isNew: true };
  }

  /**
   * Explicitly create a conversation: emits `conversation_started`, seeding the
   * owner (first-writer-wins) and an optional title before any message. Mints a
   * fresh conversationId when none is supplied. Idempotent on the conversation
   * (the command keys on `${tenantId}:${conversationId}:created`), so a retried
   * create collapses to one event.
   */
  async createConversation({
    projectId,
    userId,
    conversationId = newConversationId(),
    title,
    runToken,
  }: {
    projectId: string;
    userId: string;
    conversationId?: string;
    title?: string | null;
    /**
     * The per-conversation runToken (LANGY_WORKER_REDESIGN_PLAN §0a). The caller
     * mints it (or reuses one) and passes it so it can ALSO stash it in the turn
     * handoff — the dispatch reads it from there, not from operational state,
     * which may not have consumed the creation event before the first-turn
     * dispatch intent runs.
     * Defaults to a fresh mint when omitted. Idempotent + first-writer-wins on the
     * fold, so a retried create collapses to one token.
     */
    runToken?: string;
  }): Promise<{ id: string }> {
    await this.commands.createConversation({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      userId,
      title: title ?? null,
      runToken: runToken ?? mintRunToken(),
    });
    return { id: conversationId };
  }

  /**
   * Branch a visible conversation into a fresh conversation owned by the
   * caller. Shared conversations may be forked but never mutated in place.
   *
   * The source projection is read exactly once at command time. From there the
   * new aggregate is self-contained: its lineage and every imported message
   * are canonical events, so replay never needs the old projection or source
   * conversation to still exist.
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

    const conversationId = newConversationId();
    const title = `${source.title?.trim() || "Untitled chat"} (fork)`;
    const startedAt = Date.now();

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
      const messageId = newMessageId();
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
      },
      messages: importedMessages,
    };
  }

  /**
   * The per-conversation `runToken` (LANGY_WORKER_REDESIGN_PLAN §0a), or null
   * when the conversation has none (lazily created / predates the field). READ
   * ONLY server-side: the worker-provisioning path injects it at spawn and the
   * relay uses it to verify the worker's stream frames. It is deliberately not
   * part of any client-facing read — the same posture as the handoff token.
   */
  async getRunToken({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null> {
    return this.repository.findRunToken({ projectId, conversationId });
  }

  /**
   * Record the user's message. Replaces the old separate message/activity
   * writes: one command emits one `message_recorded` event that feeds both
   * the conversation state (count/activity/owner/title) and the operational
   * message projection.
   */
  async recordUserMessage({
    projectId,
    conversationId,
    userId,
    parts,
    title,
    role = "user",
    messageId = newMessageId(),
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
    await this.commands.recordMessage({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      userId,
      messageId,
      role,
      parts,
      title: title ?? null,
    });
    return { messageId };
  }

  /**
   * Durably accept an agent turn. Returns the turnId to correlate finalize.
   * Accepts an optional turnId so a caller can stash the out-of-band spawn
   * handoff (ADR-044) under the same id BEFORE the `agent_turn_accepted` event is
   * dispatched — closing the race where the process-outbox dispatch effect runs
   * before the handoff exists.
   */
  async acceptTurn({
    projectId,
    conversationId,
    turnId = crypto.randomUUID(),
    questionParts,
    conversationStart,
    userMessage,
    consumeHandoffTurnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId?: string;
    /** The user's question that opened the turn — folded into the turn document. */
    questionParts?: LangyMessagePart[];
    /** Optional first-event marker, committed atomically before acceptance. */
    conversationStart?: Omit<
      LangyConversationStartedEventData,
      "conversationId"
    >;
    /** Optional user message, committed atomically before acceptance. */
    userMessage?: Omit<
      LangyMessageRecordedEventData,
      "conversationId"
    >;
    /** Prior checkpoint-producing turn consumed atomically with this start. */
    consumeHandoffTurnId?: string;
  }): Promise<{ turnId: string }> {
    await this.commands.acceptAgentTurn({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
      ...(questionParts !== undefined ? { questionParts } : {}),
      ...(conversationStart ? { conversationStart } : {}),
      ...(userMessage ? { userMessage } : {}),
      ...(consumeHandoffTurnId ? { consumeHandoffTurnId } : {}),
    });
    return { turnId };
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
    const jsonInput =
      input === undefined ? undefined : langyJsonValueSchema.parse(input);
    await this.commands.initiateToolCall({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(jsonInput !== undefined ? { input: jsonInput } : {}),
    });
  }

  /**
   * Record a durable response milestone: a tool the agent finished running.
   * A tool call reaches exactly one terminal — `isError` routes it to the
   * `tool_call_failed` event (carrying `errorText`), otherwise to
   * `tool_call_succeeded`. Both share the `tool-done:<toolCallId>` idempotency
   * slot, so the first terminal for a call wins.
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
    const jsonInput =
      input === undefined ? undefined : langyJsonValueSchema.parse(input);
    const shared = {
      tenantId: projectId,
      occurredAt: Date.now(),
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
   * Record a plan snapshot for the turn (a settled `todowrite` the manager typed
   * into a `plan` frame). Snapshot-typed, last-write-wins on the turn fold — one
   * durable `plan_updated` event per todowrite call, so the checklist survives a
   * reload from the fold. The relay already dropped redelivered frames by nonce,
   * so this is dispatched at-most-once per distinct snapshot.
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
      occurredAt: Date.now(),
      conversationId,
      turnId,
      items,
    });
  }

  /**
   * Terminal failure for a response that has no answer to carry (stalled/
   * orphaned response drained by the liveness sweep, or drained on shutdown).
   * Emits `agent_response_failed`, which clears the fold's CurrentTurnId and
   * surfaces the error to the user.
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
      occurredAt: Date.now(),
      conversationId,
      turnId,
      error,
    });
  }

  /**
   * Ingest a turn result the agent posted directly over HTTP (the
   * `langy-internal` durable path). This is the independent, at-least-once
   * completion path: it survives the backend relay dropping the agent's NDJSON
   * stream after the agent finished — the failure mode where a completed turn
   * would otherwise stall until the liveness subscriber wrongly fails it.
   *
   * Idempotent on `turnId`: it dispatches the same `recordAgentResponse` /
   * `failAgentResponse` commands the relay does, whose events carry a
   * `turnId`-scoped idempotencyKey, so a duplicate (the relay already finalized,
   * or the agent's bounded retry re-posted) collapses to one event at the store.
   * Whichever path lands first wins; the other is a no-op.
   *
   * The agent posts a compact `{ text, toolCalls }` (success) or an error
   * `code` (failure); part assembly and error classification happen HERE, in one
   * place, so the durable body is identical to the relay's and never carries raw
   * agent prose (`LastError` is a vetted domain error, rendered on history load).
   */
  /**
   * True when the (projectId, conversationId, turnId) triple names a turn that
   * was really accepted under this conversation in this project. The durable
   * result-ingest route checks this before writing: unlike the relay (which
   * verifies an HMAC over the conversation's runToken), that route has only
   * the shared bearer, so without this cross-check a caller who holds the
   * secret could forge a result into any tenant's conversation, and a benign
   * projectId/conversationId mix-up in the multiplexing manager would write
   * one tenant's output into another's with nothing to catch it.
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
     * The failure's typed cause chain when the manager knew it (deserialized
     * from the wire at the boundary) — classified here so `LastError` names
     * the REAL failure (e.g. the gateway's no_provider_configured) with the
     * chain as reasons.
     */
    errorCause?: HandledError;
  }): Promise<void> {
    if (status === "failed") {
      await this.failTurn({
        projectId,
        conversationId,
        turnId,
        error: serializeLangyTurnError(
          langyAgentErrorFromErrorFrame({
            code: errorCode ?? "agent error",
            ...(errorCause !== undefined ? { cause: errorCause } : {}),
          }),
        ),
      });
      return;
    }
    await this.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: buildFinalAssistantParts({ text: text ?? "", toolCalls }),
      outcome: "completed",
    });
  }

  /**
   * The pending shutdown-handoff for a conversation, or null (ADR-048). Read
   * from the fold; the token is opaque to the control plane.
   */
  async getPendingHandoff({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null> {
    return this.repository.findPendingHandoff({ projectId, conversationId });
  }

  /**
   * Persist an opaque, worker-authored resume token a turn left when it
   * checkpointed on pod termination (ADR-048): `conversation_handoff_pending`.
   * Clears the fold's CurrentTurnId (the turn handed off, it did not fail) and
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
      occurredAt: Date.now(),
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
      occurredAt: Date.now(),
      conversationId,
      turnId,
    });
  }

  /**
   * Finalize an agent response: `agent_responded` carries the whole final
   * answer as the source of truth (streamed tokens were never events). Replaces
   * the old persistMessage(assistant) write.
   *
   * The messageId is DERIVED from the turnId, never minted fresh. Finalize has
   * two independent writers by design — the live relay's final frame and the
   * manager's durable turn-result POST — and the event store is at-least-once
   * (its idempotency key dedups at merge time, not at write time), so both
   * writes can land. Every layer downstream dedups on MessageId; a fresh KSUID
   * per call gave the two writes different ids and the reply rendered twice
   * after a reload. Same turn ⇒ same id ⇒ the duplicate collapses everywhere
   * it lands.
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
    // `stopped` is a user-initiated stop carrying the partial answer (ADR-058);
    // it shares agent_responded's turn-terminal slot with completed/failed, so a
    // stop racing a natural finish collapses to exactly one terminal.
    outcome?: "completed" | "failed" | "stopped";
    error?: string | null;
  }): Promise<{ messageId: string }> {
    const messageId = turnMessageId(turnId);
    await this.commands.recordAgentResponse({
      tenantId: projectId,
      occurredAt: Date.now(),
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
    const conv = await this.findByIdVisible({ id, projectId, userId });
    // Only the owner may archive — a shared conversation is visible, not deletable.
    if (!conv || !conv.isOwn) return false;
    await this.commands.archiveConversation({
      tenantId: projectId,
      occurredAt: Date.now(),
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
  }): Promise<ConversationDetail | null> {
    const conv = await this.findByIdVisible({ id, projectId, userId });
    if (!conv || !conv.isOwn) {
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
      ...(isShared !== undefined
        ? { isShared, sharedById: isShared ? userId : null }
        : {}),
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
    const now = Date.now();
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
  ): LangyConversationService {
    return new LangyConversationService(repository, commands, messages);
  }
}
