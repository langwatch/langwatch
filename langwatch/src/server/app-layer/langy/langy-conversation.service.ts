import { generate } from "@langwatch/ksuid";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
} from "~/server/clickhouse/clickhouseClient";
import type { CommandEnvelope } from "~/server/event-sourcing/commands/commandEnvelope";
import type {
  LangyAgentResponseFailedEventData,
  LangyAgentRespondedEventData,
  LangyAgentResponseStartedEventData,
  LangyConversationArchivedEventData,
  LangyConversationContinuedEventData,
  LangyConversationHandoffConsumedEventData,
  LangyConversationHandoffPendingEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyConversationTitleGeneratedEventData,
  LangyMessagePart,
  LangyMessageRole,
  LangyToolCallFailedEventData,
  LangyToolCallInitiatedEventData,
  LangyToolCallSucceededEventData,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  buildFinalAssistantParts,
  type LangyFinalToolCall,
} from "./langy-final-parts";
import {
  langyAgentErrorFromFrame,
  serializeLangyTurnError,
} from "~/server/services/langy/execution/langy-turn-errors";
import {
  LangyConversationNotFoundError,
  LangyConversationNotOwnedError,
} from "./errors";

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
   * Why the last turn failed, when it did (`agent_response_failed` sets it on the
   * fold). DURABLE, unlike the browser's `useChat` error — which is why a refresh
   * after a failed turn used to leave the user's question sitting there with no
   * answer and no explanation at all.
   */
  lastError: string | null;
};

/** How many months of conversations the list scan spans (ADR-046 open Q2). */
const LIST_WINDOW_MONTHS = 12;

const TABLE_NAME = "langy_conversations" as const;

/** Latest-version row read back from the langy_conversations fold table. */
interface LangyConversationRow {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  /** The last turn's failure, or null. Detail read only. */
  lastError: string | null;
  messageCount: number;
  /** 0 when the fold never set it (fall back to createdAt for the UI). */
  lastActivityAtMs: number;
  createdAtMs: number;
}

/** Raw JSONEachRow shape returned by the read queries below. */
interface LangyConversationQueryRow {
  ConversationId: string;
  UserId: string;
  Title: string | null;
  IsShared: boolean | number;
  /** Present only on the detail read (findById); the list path omits it. */
  Status?: string;
  /** Present only on the detail read (findById). */
  LastError?: string | null;
  MessageCount: string | number;
  LastActivityAtMs: string | number;
  CreatedAtMs: string | number;
}

/**
 * The minimum columns the sidebar LIST needs. Deliberately excludes Status and
 * the message content (which lives in langy_messages, not here) so a list scan
 * over the slim fold table never materialises anything heavier than a title.
 */
const LIST_LATEST_COLUMNS = `
  argMax(UserId, UpdatedAt) AS UserId,
  argMax(Title, UpdatedAt) AS Title,
  argMax(IsShared, UpdatedAt) AS IsShared,
  argMax(MessageCount, UpdatedAt) AS MessageCount,
  argMax(if(LastActivityAt IS NULL, 0, toUnixTimestamp64Milli(LastActivityAt)), UpdatedAt) AS LastActivityAtMs,
  argMax(toUnixTimestamp64Milli(CreatedAt), UpdatedAt) AS CreatedAtMs
`;

/** Latest ArchivedAt (ms, 0 when live) — inlined in HAVING, never selected. */
const LATEST_ARCHIVED_MS = `argMax(if(ArchivedAt IS NULL, 0, toUnixTimestamp64Milli(ArchivedAt)), UpdatedAt)`;

/**
 * Read-only repository over the `langy_conversations` ClickHouse fold table
 * (ADR-046). Replaces the Postgres `LangyConversation` spine reads.
 *
 * Every query filters TenantId first and dedups the ReplacingMergeTree with
 * `argMax(..., UpdatedAt)` — never FINAL. Only the columns a given read needs
 * are projected (the fold table itself is slim — no message content), archived
 * conversations are excluded, and list scans are partition-pruned by a rolling
 * `CreatedAt` window.
 */
export class LangyConversationReadRepository {
  constructor(private readonly resolver: ClickHouseClientResolver) {}

  private mapRow(r: LangyConversationQueryRow): LangyConversationRow {
    return {
      id: r.ConversationId,
      userId: r.UserId,
      title: r.Title,
      isShared: Boolean(Number(r.IsShared)),
      status: r.Status ?? "",
      lastError: r.LastError ? String(r.LastError) : null,
      messageCount: Number(r.MessageCount ?? 0),
      lastActivityAtMs: Number(r.LastActivityAtMs ?? 0),
      createdAtMs: Number(r.CreatedAtMs ?? 0),
    };
  }

  /** Latest non-archived version of one conversation, or null. */
  async findById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<LangyConversationRow | null> {
    const client = await this.resolver(projectId);
    // Point lookup on the (TenantId, ConversationId) sort key — no time window,
    // so an old-but-active conversation is always found. Fetches Status too
    // (this read backs the detail view); archived rows filtered in HAVING.
    const result = await client.query({
      query: `
        SELECT
          ConversationId,
          ${LIST_LATEST_COLUMNS},
          argMax(Status, UpdatedAt) AS Status,
          argMax(LastError, UpdatedAt) AS LastError
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND ConversationId = {conversationId:String}
        GROUP BY ConversationId
        HAVING ${LATEST_ARCHIVED_MS} = 0
      `,
      query_params: { tenantId: projectId, conversationId: id },
      format: "JSONEachRow",
    });
    const rows = await result.json<LangyConversationQueryRow>();
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  /** Owned or shared, non-archived, newest activity first. */
  async findAllForUser({
    projectId,
    userId,
    limit,
  }: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<LangyConversationRow[]> {
    const client = await this.resolver(projectId);
    // TenantId first; the CreatedAt window enables partition pruning
    // (toYYYYMM). Only the slim list columns are projected — no Status, no
    // content — and the LIMIT bounds the rows returned to the client.
    const result = await client.query({
      query: `
        SELECT ConversationId, ${LIST_LATEST_COLUMNS}
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND CreatedAt >= now() - INTERVAL {windowMonths:UInt16} MONTH
        GROUP BY ConversationId
        HAVING ${LATEST_ARCHIVED_MS} = 0
          AND (UserId = {userId:String} OR IsShared)
        ORDER BY LastActivityAtMs DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: projectId,
        userId,
        windowMonths: LIST_WINDOW_MONTHS,
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<LangyConversationQueryRow>();
    return rows.map((r) => this.mapRow(r));
  }

  /** Non-archived conversation ids owned by the user — for bulk archive. */
  async findActiveOwnedIds({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<string[]> {
    const client = await this.resolver(projectId);
    const result = await client.query({
      query: `
        SELECT ConversationId
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND CreatedAt >= now() - INTERVAL {windowMonths:UInt16} MONTH
        GROUP BY ConversationId
        HAVING argMax(if(ArchivedAt IS NULL, 0, toUnixTimestamp64Milli(ArchivedAt)), UpdatedAt) = 0
          AND argMax(UserId, UpdatedAt) = {userId:String}
      `,
      query_params: {
        tenantId: projectId,
        userId,
        windowMonths: LIST_WINDOW_MONTHS,
      },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ ConversationId: string }>();
    return rows.map((r) => r.ConversationId);
  }

  /**
   * The pending shutdown-handoff token for a conversation, or null when there
   * is nothing to resume (ADR-048). Point lookup on the (TenantId,
   * ConversationId) sort key, latest-version via argMax — never FINAL. The token
   * is opaque here; the caller threads it to a fresh worker and consumes it.
   */
  async findPendingHandoff({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null> {
    const client = await this.resolver(projectId);
    const result = await client.query({
      query: `
        SELECT
          argMax(PendingHandoffToken, UpdatedAt) AS PendingHandoffToken,
          argMax(PendingHandoffTurnId, UpdatedAt) AS PendingHandoffTurnId
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND ConversationId = {conversationId:String}
        GROUP BY ConversationId
        HAVING ${LATEST_ARCHIVED_MS} = 0
      `,
      query_params: { tenantId: projectId, conversationId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      PendingHandoffToken: string | null;
      PendingHandoffTurnId: string | null;
    }>();
    const row = rows[0];
    if (!row || !row.PendingHandoffToken || !row.PendingHandoffTurnId) {
      return null;
    }
    return { token: row.PendingHandoffToken, turnId: row.PendingHandoffTurnId };
  }
}

/** Command dispatchers injected from the event-sourcing pipeline registry. */
type Dispatch<T> = (data: T & CommandEnvelope) => Promise<void>;

export interface LangyConversationCommands {
  continueConversation: Dispatch<LangyConversationContinuedEventData>;
  createAgentResponse: Dispatch<LangyAgentResponseStartedEventData>;
  initiateToolCall: Dispatch<LangyToolCallInitiatedEventData>;
  succeedToolCall: Dispatch<LangyToolCallSucceededEventData>;
  failToolCall: Dispatch<LangyToolCallFailedEventData>;
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
 * Langy conversation service (ADR-046). Reads come from the fold projection;
 * writes are dispatched as event-sourcing commands. There is no Postgres spine
 * and no direct ClickHouse write — the conversation row is a projection.
 */
export class LangyConversationService {
  constructor(
    private readonly repository: LangyConversationReadRepository,
    private readonly commands: LangyConversationCommands,
  ) {}

  private toListItem(
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
   * A conversation the caller may see.
   *
   * THROWS `LangyConversationNotFoundError` when there is no such conversation —
   * it does not return null, and that is the whole point of this method's shape.
   *
   * The old signature returned `null` for THREE different situations: the
   * conversation does not exist, the caller may not see it, and — the one that
   * hid — the conversation exists but its ClickHouse fold has not been projected
   * yet. Three call sites hand-rolled a 404 out of that ambiguous null, and so
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
    const row = await this.repository.findById({ id, projectId });
    if (!row) throw new LangyConversationNotFoundError(id);
    // Visibility: owner always; others only when shared. Reported as not-found
    // so the error can't be used to probe for other people's conversations.
    if (row.userId !== userId && !row.isShared) {
      throw new LangyConversationNotFoundError(id);
    }
    return {
      ...this.toListItem(row, userId),
      status: row.status,
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
    return rows.map((r) => this.toListItem(r, userId));
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
   * is created by the first `continueConversation`. Verifies ownership against the fold;
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
  }): Promise<{ id: string }> {
    if (conversationId) {
      // Resolve straight from the repo (not the share-aware getById): visibility
      // of a shared conversation does not grant continuation rights.
      const existing = await this.repository.findById({
        id: conversationId,
        projectId,
      });
      if (existing) {
        if (existing.userId !== userId) {
          throw new LangyConversationNotOwnedError(conversationId);
        }
        return { id: conversationId };
      }
      // Archived / never existed: fall through and mint a fresh id — a stale id
      // is legitimate client state, unlike one owned by another user.
    }
    return { id: newConversationId() };
  }

  /**
   * Record the user's message. Replaces the old persistMessage(user) +
   * bumpActivity dual write: one command emits one `conversation_continued`
   * event that feeds both the conversation fold (count/activity/owner/title) and
   * the message map projection (langy_messages row).
   */
  async recordUserMessage({
    projectId,
    conversationId,
    userId,
    parts,
    title,
    role = "user",
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: LangyMessagePart[];
    title?: string | null;
    role?: LangyMessageRole;
  }): Promise<{ messageId: string }> {
    const messageId = newMessageId();
    await this.commands.continueConversation({
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
   * Mark the start of an agent turn. Returns the turnId to correlate finalize.
   * Accepts an optional turnId so a caller can stash the out-of-band spawn
   * handoff (ADR-044) under the same id BEFORE the `agent_response_started` event is
   * dispatched — closing the race where the spawn reactor fires before the
   * handoff exists.
   */
  async startTurn({
    projectId,
    conversationId,
    turnId = crypto.randomUUID(),
  }: {
    projectId: string;
    conversationId: string;
    turnId?: string;
  }): Promise<{ turnId: string }> {
    await this.commands.createAgentResponse({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
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
    await this.commands.initiateToolCall({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(input !== undefined ? { input } : {}),
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
    const shared = {
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
      toolCallId,
      toolName,
      ...(command !== undefined ? { command } : {}),
      ...(input !== undefined ? { input } : {}),
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
   * would otherwise stall until the liveness reactor wrongly fails it.
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
  async ingestAgentTurnResult({
    projectId,
    conversationId,
    turnId,
    status,
    text,
    toolCalls,
    errorCode,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    status: "completed" | "failed";
    text?: string;
    toolCalls?: LangyFinalToolCall[];
    errorCode?: string;
  }): Promise<void> {
    if (status === "failed") {
      await this.failTurn({
        projectId,
        conversationId,
        turnId,
        error: serializeLangyTurnError(
          langyAgentErrorFromFrame(errorCode ?? "agent error"),
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
    outcome?: "completed" | "failed";
    error?: string | null;
  }): Promise<{ messageId: string }> {
    const messageId = newMessageId();
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
    resolver?: ClickHouseClientResolver,
  ): LangyConversationService {
    const clickhouse: ClickHouseClientResolver =
      resolver ??
      (async (projectId) => {
        const client = await getClickHouseClientForProject(projectId);
        if (!client)
          throw new Error(
            `No ClickHouse client configured for project ${projectId}`,
          );
        return client;
      });
    return new LangyConversationService(
      new LangyConversationReadRepository(clickhouse),
      commands,
    );
  }
}
