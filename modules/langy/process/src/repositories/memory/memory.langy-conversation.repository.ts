import type { StoredProjection } from "@langwatch/eventing";
import {
  LangyConversationNotFoundError,
  type LangyConversationStateData,
  type LangyUsageCount,
} from "@langwatch/langy-contract";

import {
  LangyConversationRepository,
  type LangyConversationListCursor,
  type LangyConversationResumeState,
  type LangyConversationRow,
} from "../langy-conversation-projection.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

type Projection = StoredProjection<LangyConversationStateData>;

function toRow(projection: Projection): LangyConversationRow {
  const { state } = projection;
  return {
    id: state.ConversationId,
    userId: state.UserId,
    title: state.Title,
    isShared: state.IsShared,
    status: state.Status,
    currentTurnId: state.CurrentTurnId,
    lastError: state.LastError,
    lastModel: state.LastModel,
    messageCount: state.MessageCount,
    lastActivityAtMs: state.LastActivityAt ?? 0,
    cursorActivityAtMs: state.LastActivityAt,
    createdAtMs: projection.createdAt,
    eventCursor: { acceptedAt: projection.cursor.acceptedAt, eventId: projection.cursor.eventId },
  };
}

function compareIds(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Activity descending with null last, then id descending: the live list's order. */
function byRecentActivity(a: Projection, b: Projection): number {
  const left = a.state.LastActivityAt;
  const right = b.state.LastActivityAt;
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  }
  return compareIds(b.state.ConversationId, a.state.ConversationId);
}

function isAfter(projection: Projection, cursor: LangyConversationListCursor): boolean {
  const activity = projection.state.LastActivityAt;
  const id = projection.state.ConversationId;
  if (cursor.lastActivityAtMs === null) return activity === null && id < cursor.id;
  if (activity === null) return true;
  return (
    activity < cursor.lastActivityAtMs || (activity === cursor.lastActivityAtMs && id < cursor.id)
  );
}

/** The memory twin of `PrismaLangyConversationRepository`, over the rows the folds stored. */
export class MemoryLangyConversationRepository extends LangyConversationRepository {
  static create(store: LangyMemoryStore): MemoryLangyConversationRepository {
    return new MemoryLangyConversationRepository(store);
  }

  private constructor(private readonly store: LangyMemoryStore) {
    super();
  }

  async countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<LangyUsageCount> {
    const projects = new Set(input.projectIds);
    const since = input.since;
    const turns = [...this.store.turns.values()].filter((row) => projects.has(row.projectId));
    const owners = new Set(
      [...this.store.conversations.values()]
        .filter((row) => projects.has(row.projectId))
        .filter(
          (row) =>
            since === undefined ||
            (row.projection.state.LastActivityAt ?? -Infinity) >= since ||
            row.projection.createdAt >= since,
        )
        .map((row) => row.projection.state.UserId),
    );
    const first = turns
      .map((row) => row.projection.createdAt)
      .reduce<number | undefined>(
        (min, at) => (min === undefined || at < min ? at : min),
        undefined,
      );
    return {
      turns: turns.filter((row) => since === undefined || row.projection.createdAt >= since).length,
      activeUsers: owners.size,
      ...(first !== undefined ? { firstTurnAt: first } : {}),
    };
  }

  async getVisibleById(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationRow> {
    const projection = this.find(params.projectId, params.id);
    if (
      !projection ||
      projection.state.ArchivedAt !== null ||
      (projection.state.UserId !== params.userId && !projection.state.IsShared)
    ) {
      throw new LangyConversationNotFoundError(params.id);
    }
    return toRow(projection);
  }

  async findOwnership(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<"owned" | "other" | "archived" | "missing"> {
    const projection = this.find(params.projectId, params.id);
    if (!projection) return "missing";
    if (projection.state.ArchivedAt !== null) return "archived";
    return projection.state.UserId === params.userId ? "owned" : "other";
  }

  async findAllForUser(params: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationRow[]> {
    const query = params.query?.toLowerCase();
    const cursor = params.cursor;
    return this.inProject(params.projectId)
      .filter((projection) => projection.state.ArchivedAt === null)
      .filter(
        (projection) => projection.state.UserId === params.userId || projection.state.IsShared,
      )
      .filter(
        (projection) => !query || (projection.state.Title ?? "").toLowerCase().includes(query),
      )
      .filter((projection) => !cursor || isAfter(projection, cursor))
      .toSorted(byRecentActivity)
      .slice(0, params.limit)
      .map(toRow);
  }

  async findActiveOwnedIds(params: { projectId: string; userId: string }): Promise<string[]> {
    return this.inProject(params.projectId)
      .filter(
        (projection) =>
          projection.state.UserId === params.userId && projection.state.ArchivedAt === null,
      )
      .map((projection) => projection.state.ConversationId);
  }

  async getResumeState(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationResumeState> {
    const projection = this.find(params.projectId, params.conversationId);
    if (!projection || projection.state.ArchivedAt !== null) {
      throw new LangyConversationNotFoundError(params.conversationId);
    }
    const { PendingHandoffToken, PendingHandoffTurnId, RunToken } = projection.state;
    return {
      pendingHandoff:
        PendingHandoffToken && PendingHandoffTurnId
          ? { token: PendingHandoffToken, turnId: PendingHandoffTurnId }
          : null,
      runToken: RunToken,
    };
  }

  async hasAdmittedTurn(params: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<boolean> {
    return [...this.store.turnRequests.values()].some(
      (receipt) =>
        receipt.projectId === params.projectId &&
        receipt.conversationId === params.conversationId &&
        receipt.userId === params.userId,
    );
  }

  async turnExists(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    return this.store.turns.has(`${params.projectId}:${params.conversationId}:${params.turnId}`);
  }

  private find(projectId: string, conversationId: string): Projection | undefined {
    return this.store.conversations.get(`${projectId}:${conversationId}`)?.projection;
  }

  private inProject(projectId: string): Projection[] {
    return [...this.store.conversations.values()]
      .filter((row) => row.projectId === projectId)
      .map((row) => row.projection);
  }
}
