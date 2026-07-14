export interface LangyConversationRow {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  lastError: string | null;
  messageCount: number;
  lastActivityAtMs: number;
  /** Raw nullable sort value; unlike lastActivityAtMs, this never falls back. */
  cursorActivityAtMs?: number | null;
  createdAtMs: number;
}

/** Stable keyset cursor for the recent-conversations ordering. */
export interface LangyConversationListCursor {
  lastActivityAtMs: number | null;
  id: string;
}

/** Application-facing reads over the rebuildable operational projection. */
export interface LangyConversationRepository {
  findVisibleById(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationRow | null>;

  findOwnership(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<"owned" | "other" | "missing">;

  findAllForUser(params: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationRow[]>;

  findActiveOwnedIds(params: {
    projectId: string;
    userId: string;
  }): Promise<string[]>;

  findPendingHandoff(params: {
    projectId: string;
    conversationId: string;
  }): Promise<{ token: string; turnId: string } | null>;

  findRunToken(params: {
    projectId: string;
    conversationId: string;
  }): Promise<string | null>;
}

export class NullLangyConversationRepository
  implements LangyConversationRepository
{
  async findVisibleById(): Promise<null> {
    return null;
  }

  async findOwnership(): Promise<"missing"> {
    return "missing";
  }

  async findAllForUser(): Promise<LangyConversationRow[]> {
    return [];
  }

  async findActiveOwnedIds(): Promise<string[]> {
    return [];
  }

  async findPendingHandoff(): Promise<null> {
    return null;
  }

  async findRunToken(): Promise<null> {
    return null;
  }
}
