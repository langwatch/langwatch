import { generate } from "@langwatch/ksuid";
import {
  type ClickHouseClientResolver,
  getClickHouseClientForProject,
} from "~/server/clickhouse/clickhouseClient";
import type { CommandEnvelope } from "~/server/event-sourcing/commands/commandEnvelope";
import type {
  LangyConversationArchivedEventData,
  LangyConversationMetadataUpdatedEventData,
  LangyAgentTurnStartedEventData,
  LangyMessagePart,
  LangyMessageRole,
  LangyMessageSentEventData,
  LangyProgressReportedEventData,
  LangyStatusReportedEventData,
  LangyTurnFinalizedEventData,
} from "~/server/event-sourcing/pipelines/langy-conversation-processing";
import { KSUID_RESOURCES } from "~/utils/constants";
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
};

/** How many months of conversations the list scan spans (ADR-043 open Q2). */
const LIST_WINDOW_MONTHS = 12;

const TABLE_NAME = "langy_conversations" as const;

/** Latest-version row read back from the langy_conversations fold table. */
interface LangyConversationRow {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
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
 * (ADR-043). Replaces the Postgres `LangyConversation` spine reads.
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
          argMax(Status, UpdatedAt) AS Status
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
}

/** Command dispatchers injected from the event-sourcing pipeline registry. */
type Dispatch<T> = (data: T & CommandEnvelope) => Promise<void>;

export interface LangyConversationCommands {
  sendMessage: Dispatch<LangyMessageSentEventData>;
  startAgentTurn: Dispatch<LangyAgentTurnStartedEventData>;
  reportStatus: Dispatch<LangyStatusReportedEventData>;
  reportProgress: Dispatch<LangyProgressReportedEventData>;
  reconcileAgentTurn: Dispatch<LangyTurnFinalizedEventData>;
  archiveConversation: Dispatch<LangyConversationArchivedEventData>;
  updateConversationMetadata: Dispatch<LangyConversationMetadataUpdatedEventData>;
}

function newConversationId(): string {
  return generate(KSUID_RESOURCES.LANGY_CONVERSATION).toString();
}

function newMessageId(): string {
  return generate(KSUID_RESOURCES.LANGY_MESSAGE).toString();
}

/**
 * Langy conversation service (ADR-043). Reads come from the fold projection;
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

  async getById({
    id,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<ConversationDetail | null> {
    const row = await this.repository.findById({ id, projectId });
    if (!row) return null;
    // Visibility: owner always; others only when shared.
    if (row.userId !== userId && !row.isShared) return null;
    return { ...this.toListItem(row, userId), status: row.status };
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
   * Resolve the conversation id for a chat turn. Does NOT write — the aggregate
   * is created by the first `sendMessage`. Verifies ownership against the fold;
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
   * bumpActivity dual write: one command emits one `message_sent` event that
   * feeds both the conversation fold (count/activity/owner/title) and the
   * message map projection (langy_messages row).
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
    await this.commands.sendMessage({
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

  /** Mark the start of an agent turn. Returns the turnId to correlate finalize. */
  async startTurn({
    projectId,
    conversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<{ turnId: string }> {
    const turnId = crypto.randomUUID();
    await this.commands.startAgentTurn({
      tenantId: projectId,
      occurredAt: Date.now(),
      conversationId,
      turnId,
    });
    return { turnId };
  }

  /**
   * Finalize an agent turn: `turn_finalized` carries the whole final answer as
   * the source of truth (streamed tokens were never events). Replaces the old
   * persistMessage(assistant) write.
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
    await this.commands.reconcileAgentTurn({
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
    const conv = await this.getById({ id, projectId, userId });
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
    const conv = await this.getById({ id, projectId, userId });
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
