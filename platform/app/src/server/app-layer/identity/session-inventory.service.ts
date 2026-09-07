import { HandledError } from "@langwatch/handled-error";
import { signInProvedSecondFactor } from "@langwatch/identity";
import { signInMethodLabelFor } from "./session-claims";

/**
 * Somebody asked to end the session they are reading from.
 *
 * Named rather than silently refused: "nothing happened" and "that one is
 * yours" look identical on a list, and the second has an action attached to
 * it — sign out — that the first does not.
 */
export class SessionIsCurrentError extends HandledError {
  declare readonly code: "session_is_current";

  constructor() {
    super(
      "session_is_current",
      "Signing out of the browser you are reading this in is a different act; use the sign-out control.",
      { httpStatus: 400, meta: {} },
    );
    this.name = "SessionIsCurrentError";
  }
}

/**
 * Somebody's own signed-in sessions, and the one way to end a set of them
 * without ending them all (D06).
 *
 * Two jobs, one subject: the list a person reads on their devices tab, and
 * per-identifier revocation - ending every session one sign-in method minted
 * and leaving the rest untouched. They belong together because they are the
 * same question asked twice: which sessions did this method mint.
 *
 * Per-identifier revocation is a NARROWER instrument than the revoke-all a
 * password reset performs, never a replacement for it. A reset still ends
 * every session whatever minted it; this ends the sessions behind one method
 * a person no longer trusts, or that an operator is detaching.
 */

/** One session, as the store holds it. */
export interface SessionRecord {
  id: string;
  sessionToken: string;
  identifierId: string | null;
  amr: readonly string[];
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  /**
   * When the row was last written. better-auth rolls a live session's expiry
   * once per `updateAge` (a day), so this is activity to the nearest day and
   * never finer — enough to tell a browser somebody used this morning from one
   * they have not touched since February, which is the only question asked of
   * it.
   */
  updatedAt: Date;
  expires: Date;
}

/** One session, as its owner reads it. */
export interface SessionInventoryEntry {
  sessionId: string;
  /** Which sign-in method minted it; null on every session that predates it. */
  identifierId: string | null;
  /** How it signed in, in words - never `pwd` or `phw`. */
  method: string;
  /** Whether the sign-in that minted it proved a second factor. */
  secondFactorProven: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  signedInAt: Date;
  /** Activity to the nearest day; see `SessionRecord.updatedAt`. */
  lastActiveAt: Date;
  expiresAt: Date;
  /** Whether this is the session doing the reading. */
  current: boolean;
}

export interface SessionRecordsPort {
  /** This person's live sessions, newest first. */
  listForUser(args: { userId: string }): Promise<readonly SessionRecord[]>;
  /** The sessions one sign-in method minted, for this person alone. */
  listForIdentifier(args: {
    userId: string;
    identifierId: string;
  }): Promise<readonly SessionRecord[]>;
  /** Ends exactly the named sessions. Answers how many rows went. */
  deleteByIds(args: { ids: readonly string[] }): Promise<number>;
}

/**
 * The session cache better-auth reads before the database. Clearing it is
 * what makes a revocation take effect now rather than at the cache's TTL,
 * which is thirty days.
 */
export interface SessionCachePort {
  dropTokens(args: {
    userId: string;
    tokens: readonly string[];
  }): Promise<void>;
}

export interface SessionInventoryServiceDeps {
  records: SessionRecordsPort;
  cache: SessionCachePort;
}

export class SessionInventoryService {
  constructor(private readonly deps: SessionInventoryServiceDeps) {}

  /** What this person is signed in on, and how each one signed in. */
  async listFor({
    userId,
    currentSessionId,
  }: {
    userId: string;
    currentSessionId?: string;
  }): Promise<readonly SessionInventoryEntry[]> {
    const sessions = await this.deps.records.listForUser({ userId });
    return sessions.map((session) => ({
      sessionId: session.id,
      identifierId: session.identifierId,
      method: signInMethodLabelFor({ amr: session.amr }),
      secondFactorProven: signInProvedSecondFactor(session.amr),
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      signedInAt: session.createdAt,
      lastActiveAt: session.updatedAt,
      expiresAt: session.expires,
      current: session.id === currentSessionId,
    }));
  }

  /**
   * End ONE session, named by the person who owns it.
   *
   * The narrowest instrument of the three: somebody looking at a browser they
   * no longer have ends that one and keeps the rest, without having to work
   * out which sign-in method minted it.
   *
   * The session is found in the caller's OWN list rather than deleted by id,
   * so naming somebody else's session ends nothing rather than ending theirs —
   * the same rule `endSessionsForIdentifier` follows, and the reason neither
   * takes a user id from the thing being ended.
   *
   * Ending the session doing the reading is refused here rather than left to
   * the screen: signing yourself out is a different act with a different
   * button, and a revoke that silently logged you out would read as a bug.
   *
   * Cache first, then the row — the ordering `endSessionsForIdentifier`
   * explains.
   */
  async endSession({
    userId,
    sessionId,
    currentSessionId,
  }: {
    userId: string;
    sessionId: string;
    /** The session doing the asking, which may not end itself. */
    currentSessionId?: string;
  }): Promise<{ ended: number }> {
    if (currentSessionId && sessionId === currentSessionId) {
      throw new SessionIsCurrentError();
    }
    const sessions = await this.deps.records.listForUser({ userId });
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return { ended: 0 };

    await this.deps.cache.dropTokens({
      userId,
      tokens: [session.sessionToken],
    });
    const ended = await this.deps.records.deleteByIds({ ids: [session.id] });
    return { ended };
  }

  /**
   * End every session one sign-in method minted, and no others.
   *
   * Scoped to the person on purpose: the identifier is theirs, and taking the
   * user id from the caller rather than from the identifier means a caller
   * cannot end somebody else's sessions by naming an identifier that is not
   * theirs.
   *
   * The cache is cleared BEFORE the rows go, so there is no window in which
   * the row is gone and better-auth still answers from the cache.
   */
  async endSessionsForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }> {
    const sessions = await this.deps.records.listForIdentifier({
      userId,
      identifierId,
    });
    if (sessions.length === 0) return { ended: 0 };

    await this.deps.cache.dropTokens({
      userId,
      tokens: sessions.map((session) => session.sessionToken),
    });
    const ended = await this.deps.records.deleteByIds({
      ids: sessions.map((session) => session.id),
    });
    return { ended };
  }
}
