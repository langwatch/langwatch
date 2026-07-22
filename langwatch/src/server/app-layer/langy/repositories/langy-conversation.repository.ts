export interface LangyConversationRow {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  /**
   * The turn the conversation has IN FLIGHT right now, or null when none is.
   *
   * The durable answer to "which turn would a Stop stop?". A browser tab only
   * learns a turn id from its own send, so without this a turn adopted from the
   * record — another tab's, or one rejoined after a refresh — had a Stop button
   * with no id behind it.
   */
  currentTurnId: string | null;
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

  /**
   * True when a turn projection row exists for this exact
   * (projectId, conversationId, turnId) triple — i.e. the turn was really
   * accepted under this conversation in this project. The durable
   * result-ingest uses it to reject a forged or mismatched triple before
   * writing (the relay proves the same thing with an HMAC; this path has only
   * the bearer). A turn row exists the moment `acceptTurn` is projected, long
   * before any result arrives.
   */
  turnExists(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean>;
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

  async turnExists(): Promise<boolean> {
    return false;
  }
}
