import { LangyConversationNotFoundError, type LangyUsageCount } from "@langwatch/langy-contract";

export interface LangyConversationRow {
  id: string;
  userId: string;
  title: string | null;
  isShared: boolean;
  status: string;
  /**
   * The turn the conversation has IN FLIGHT right now, or null when none.
   * The durable answer to "which turn would a Stop stop?" - a tab only
   * learns a turn id from its own send, so an adopted turn needs this too.
   */
  currentTurnId: string | null;
  lastError: string | null;
  /**
   * The model the latest accepted turn ran on, or null before any turn
   * recorded one. Reopening the conversation seeds the composer from it.
   */
  lastModel: string | null;
  messageCount: number;
  lastActivityAtMs: number;
  /** Raw nullable sort value; unlike lastActivityAtMs, this never falls back. */
  cursorActivityAtMs?: number | null;
  createdAtMs: number;
  /**
   * The projection's event cursor (ADR-059): the snapshot position the client
   * folds its durable tail from. Optional so list reads may omit it.
   */
  eventCursor?: { acceptedAt: number; eventId: string } | null;
}

/** The resume columns of one conversation's projection row; null columns are data, not absence. */
export interface LangyConversationResumeState {
  pendingHandoff: { token: string; turnId: string } | null;
  runToken: string | null;
}

/** Stable keyset cursor for the recent-conversations ordering. */
export interface LangyConversationListCursor {
  lastActivityAtMs: number | null;
  id: string;
}

/** Application-facing reads over the rebuildable operational projection. */
export abstract class LangyConversationRepository {
  /** The usage report's counts; the caller never passes an empty project list. */
  abstract countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<LangyUsageCount>;

  /** Throws `LangyConversationNotFoundError` when missing, archived or not visible to the user. */
  abstract getVisibleById(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<LangyConversationRow>;

  abstract findOwnership(params: {
    id: string;
    projectId: string;
    userId: string;
  }): Promise<"owned" | "other" | "archived" | "missing">;

  abstract findAllForUser(params: {
    projectId: string;
    userId: string;
    limit: number;
    cursor?: LangyConversationListCursor;
    query?: string;
  }): Promise<LangyConversationRow[]>;

  abstract findActiveOwnedIds(params: { projectId: string; userId: string }): Promise<string[]>;

  /** Throws `LangyConversationNotFoundError` when the conversation is missing or archived. */
  abstract getResumeState(params: {
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationResumeState>;

  /**
   * True when this user has sent a turn on this conversation: a turn receipt
   * exists for the triple, written at admission time before any event is
   * folded — the one signal a create is in flight before its projection lands.
   */
  abstract hasAdmittedTurn(params: {
    projectId: string;
    conversationId: string;
    userId: string;
  }): Promise<boolean>;

  /** Checks if a turn projection row exists for the (projectId, conversationId, turnId) triple.
   * Result-ingest rejects forged or mismatched triples before writing (the relay uses HMAC). */
  abstract turnExists(params: {
    projectId: string;
    conversationId: string;
    turnId: string;
  }): Promise<boolean>;
}

export class NullLangyConversationRepository extends LangyConversationRepository {
  async countUsage(): Promise<LangyUsageCount> {
    return { turns: 0, activeUsers: 0 };
  }

  async getVisibleById({ id }: { id: string }): Promise<LangyConversationRow> {
    throw new LangyConversationNotFoundError(id);
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

  async getResumeState({
    conversationId,
  }: {
    conversationId: string;
  }): Promise<LangyConversationResumeState> {
    throw new LangyConversationNotFoundError(conversationId);
  }

  async hasAdmittedTurn(): Promise<boolean> {
    return false;
  }

  async turnExists(): Promise<boolean> {
    return false;
  }
}
