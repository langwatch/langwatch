import {
  LangyConversationNotFoundError,
  langyTurnToolCallSchema,
  type LangyUsageCount,
} from "@langwatch/langy-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import type { LangyTurnFactRow } from "../../rules/langy-turn-facts.rules.ts";
import { LangyConversationRepository } from "../langy-conversation-projection.repository.ts";
import type {
  LangyConversationListCursor,
  LangyConversationResumeState,
  LangyConversationRow,
} from "../langy-conversation-projection.repository.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";

type Row = Prisma.LangyConversationProjectionGetPayload<object>;

const toolCallsSchema = z.array(langyTurnToolCallSchema);
const TURN_FACT_COLUMNS = {
  projectId: true,
  ConversationId: true,
  TurnId: true,
  Status: true,
  Error: true,
  CreatedAt: true,
  StartedAt: true,
  EndedAt: true,
  ToolCalls: true,
} as const;
type TurnFactColumns = Prisma.LangyConversationTurnProjectionGetPayload<{
  select: typeof TURN_FACT_COLUMNS;
}>;

function toRow(row: Row): LangyConversationRow {
  return {
    id: row.ConversationId,
    userId: row.UserId,
    title: row.Title,
    isShared: row.IsShared,
    origin: row.Origin,
    status: row.Status,
    currentTurnId: row.CurrentTurnId,
    lastError: row.LastError,
    lastModel: row.LastModel,
    messageCount: row.MessageCount,
    lastActivityAtMs: row.LastActivityAt ?? 0,
    cursorActivityAtMs: row.LastActivityAt,
    createdAtMs: row.CreatedAt,
    eventCursor: { acceptedAt: row.AcceptedAt, eventId: row.LastEventId },
  };
}

function afterCursor(
  cursor: LangyConversationListCursor,
): Prisma.LangyConversationProjectionWhereInput {
  if (cursor.lastActivityAtMs === null) {
    return {
      LastActivityAt: null,
      ConversationId: { lt: cursor.id },
    };
  }

  return {
    OR: [
      { LastActivityAt: { lt: cursor.lastActivityAtMs } },
      {
        LastActivityAt: cursor.lastActivityAtMs,
        ConversationId: { lt: cursor.id },
      },
      // Null activity sorts after every concrete activity timestamp.
      { LastActivityAt: null },
    ],
  };
}

export class PrismaLangyConversationRepository extends LangyConversationRepository {
  constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyConversationRepository {
    return new PrismaLangyConversationRepository(database);
  }

  /** Turns by the day they were taken; people as distinct owners active in the window. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<LangyUsageCount> {
    const scope = { projectId: { in: [...projectIds] } };
    const [turns, owners, first] = await Promise.all([
      this.prisma.langyConversationTurnProjection.count({
        where: since === undefined ? scope : { ...scope, CreatedAt: { gte: since } },
      }),
      this.prisma.langyConversationProjection.groupBy({
        by: ["UserId"],
        where:
          since === undefined
            ? scope
            : {
                ...scope,
                // Active when its last activity falls in the window, or it opened there unstamped.
                OR: [{ LastActivityAt: { gte: since } }, { CreatedAt: { gte: since } }],
              },
      }),
      this.prisma.langyConversationTurnProjection.findFirst({
        where: scope,
        orderBy: { CreatedAt: "asc" },
        select: { CreatedAt: true },
      }),
    ]);
    return {
      turns,
      activeUsers: owners.length,
      ...(first ? { firstTurnAt: Number(first.CreatedAt) } : {}),
    };
  }

  async findTurnFactRows({
    projectIds,
    since,
    until,
  }: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<LangyTurnFactRow[]> {
    const turns = await this.prisma.langyConversationTurnProjection.findMany({
      where: { projectId: { in: [...projectIds] }, CreatedAt: { gte: since, lt: until } },
      select: TURN_FACT_COLUMNS,
    });
    return this.withOwners({ turns, projectIds });
  }

  async findConversationTurnFactRows({
    projectId,
    conversationId: ConversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyTurnFactRow[]> {
    const turns = await this.prisma.langyConversationTurnProjection.findMany({
      where: { projectId, ConversationId },
      select: TURN_FACT_COLUMNS,
      orderBy: [{ CreatedAt: "asc" }, { TurnId: "asc" }],
    });
    return this.withOwners({ turns, projectIds: [projectId] });
  }

  async conversationExists({
    projectId,
    conversationId: ConversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<boolean> {
    const row = await this.prisma.langyConversationProjection.findFirst({
      where: { projectId, ConversationId },
      select: { id: true },
    });
    return row !== null;
  }

  /** Joins each turn to its conversation's owner and latest model, read in one query. */
  private async withOwners({
    turns,
    projectIds,
  }: {
    turns: TurnFactColumns[];
    projectIds: readonly string[];
  }): Promise<LangyTurnFactRow[]> {
    if (turns.length === 0) return [];
    const conversations = await this.prisma.langyConversationProjection.findMany({
      where: {
        projectId: { in: [...projectIds] },
        ConversationId: { in: [...new Set(turns.map((turn) => turn.ConversationId))] },
      },
      select: { projectId: true, ConversationId: true, UserId: true, LastModel: true },
    });
    const owners = new Map(
      conversations.map((row) => [`${row.projectId}:${row.ConversationId}`, row] as const),
    );
    return turns.map((turn) => {
      const owner = owners.get(`${turn.projectId}:${turn.ConversationId}`);
      return {
        projectId: turn.projectId,
        conversationId: turn.ConversationId,
        turnId: turn.TurnId,
        status: turn.Status,
        error: turn.Error,
        createdAt: Number(turn.CreatedAt),
        startedAt: turn.StartedAt === null ? null : Number(turn.StartedAt),
        endedAt: turn.EndedAt === null ? null : Number(turn.EndedAt),
        userId: owner?.UserId ?? null,
        model: owner?.LastModel ?? null,
        toolCalls: toolCallsSchema.safeParse(turn.ToolCalls).data ?? [],
      };
    });
  }

  async getVisibleById({
    id: ConversationId,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationRow> {
    const row = await this.prisma.langyConversationProjection.findFirst({
      where: {
        projectId,
        ConversationId,
        ArchivedAt: null,
        OR: [{ UserId: userId }, { IsShared: true }],
      },
    });
    if (!row) throw new LangyConversationNotFoundError(ConversationId);
    return toRow(row);
  }

  async findOwnership({
    id: ConversationId,
    projectId,
    userId,
  }: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<"owned" | "other" | "archived" | "missing"> {
    const row = await this.prisma.langyConversationProjection.findUnique({
      // The compound key identifies the row to Prisma, while the explicit
      // tenant predicate is what the tenancy middleware can verify before the
      // query reaches Postgres. Keep both: one is a database selector, the
      // other is the app-layer isolation boundary.
      where: {
        projectId,
        projectId_ConversationId: { projectId, ConversationId },
      },
      select: { UserId: true, ArchivedAt: true },
    });
    if (!row) return "missing";
    // Archived is its own answer, not "missing": most callers treat the two
    // alike (a stale id legitimately yields a fresh conversation), but id
    // ADOPTION must refuse an archived collision rather than silently append
    // to a closed aggregate — see `ensureConversation`.
    if (row.ArchivedAt !== null) return "archived";
    return row.UserId === userId ? "owned" : "other";
  }

  async findAllForUser({
    projectId,
    userId,
    limit,
    cursor,
    query,
  }: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationRow[]> {
    const rows = await this.prisma.langyConversationProjection.findMany({
      where: {
        projectId,
        ArchivedAt: null,
        OR: [{ UserId: userId }, { IsShared: true }],
        ...(query ? { Title: { contains: query, mode: "insensitive" as const } } : {}),
        ...(cursor ? { AND: [afterCursor(cursor)] } : {}),
      },
      orderBy: [{ LastActivityAt: { sort: "desc", nulls: "last" } }, { ConversationId: "desc" }],
      take: limit,
    });
    return rows.map(toRow);
  }

  async findActiveOwnedIds({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.langyConversationProjection.findMany({
      where: { projectId, UserId: userId, ArchivedAt: null },
      select: { ConversationId: true },
    });
    return rows.map((row: { ConversationId: string }) => row.ConversationId);
  }

  async getResumeState({
    projectId,
    conversationId: ConversationId,
  }: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationResumeState> {
    const row = await this.prisma.langyConversationProjection.findFirst({
      where: { projectId, ConversationId, ArchivedAt: null },
      select: { PendingHandoffToken: true, PendingHandoffTurnId: true, RunToken: true },
    });
    if (!row) throw new LangyConversationNotFoundError(ConversationId);
    return {
      pendingHandoff:
        row.PendingHandoffToken && row.PendingHandoffTurnId
          ? { token: row.PendingHandoffToken, turnId: row.PendingHandoffTurnId }
          : null,
      runToken: row.RunToken,
    };
  }

  async hasAdmittedTurn({
    projectId,
    conversationId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<boolean> {
    const row = await this.prisma.langyTurnRequest.findFirst({
      where: { projectId, conversationId, userId },
      select: { id: true },
    });
    return row !== null;
  }

  async turnExists({
    projectId,
    conversationId: ConversationId,
    turnId: TurnId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    const row = await this.prisma.langyConversationTurnProjection.findFirst({
      where: { projectId, ConversationId, TurnId },
      select: { id: true },
    });
    return row !== null;
  }
}
