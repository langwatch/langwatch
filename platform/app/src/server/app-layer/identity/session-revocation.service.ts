import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:identity:session-revocation");

/** One session, as revocation needs to name it: the row, and the cache key. */
export interface RevocableSession {
  id: string;
  sessionToken: string;
}

/**
 * One session as better-auth lists it in a person's cached index of live
 * sessions. `expiresAt` is carried rather than read: an index rewritten
 * without it is an index better-auth can no longer age out.
 */
export interface CachedSession {
  token: string;
  expiresAt: number;
}

/**
 * The session rows, as revocation needs them.
 *
 * Every read here answers tokens for EVERY row the predicate matches, expired
 * ones included. The cached copy of a session outlives the row's own expiry,
 * so a token skipped for being expired is a token better-auth would keep
 * answering from.
 */
export interface SessionRevocationRecordsPort {
  /** Every session token this person holds. */
  findTokensForUser(args: { userId: string }): Promise<readonly string[]>;
  /** Every session token this person holds except the named session's. */
  findTokensForUserExcept(args: {
    userId: string;
    keepSessionId: string;
  }): Promise<readonly string[]>;
  /** One session's token, or null when there is no such row. */
  findTokenForSession(args: { sessionId: string }): Promise<string | null>;
  /** The sessions one sign-in method minted, for this person alone. */
  findForIdentifier(args: {
    userId: string;
    identifierId: string;
  }): Promise<readonly RevocableSession[]>;
  /** Ends every session this person holds. Answers how many rows went. */
  deleteAllForUser(args: { userId: string }): Promise<number>;
  /** Ends every session this person holds except the named one. */
  deleteForUserExcept(args: {
    userId: string;
    keepSessionId: string;
  }): Promise<number>;
  /** Ends exactly the named sessions. */
  deleteByIds(args: { ids: readonly string[] }): Promise<number>;
  /** Ends the session behind one token; 0 when it had already gone. */
  deleteByToken(args: { token: string }): Promise<number>;
}

/**
 * better-auth's session cache, as revocation needs it: the per-token entries
 * it reads a session from, and the per-user index it lists live tokens in.
 *
 * Every method here is a raw store operation that reports its failure by
 * throwing. Deciding that a cache we could not clear delays a revocation
 * rather than failing it is the service's call, not the store's.
 */
export interface SessionRevocationCachePort {
  /**
   * The person's cached index of live sessions; null when there is none and
   * when the one there cannot be read.
   */
  readIndex(args: { userId: string }): Promise<readonly CachedSession[] | null>;
  /** Rewrites the index to exactly these sessions. */
  writeIndex(args: {
    userId: string;
    sessions: readonly CachedSession[];
  }): Promise<void>;
  /** Drops the index. */
  dropIndex(args: { userId: string }): Promise<void>;
  /** Drops the cached session behind each token. */
  dropSessions(args: { tokens: readonly string[] }): Promise<void>;
}

export interface SessionRevocationServiceDeps {
  records: SessionRevocationRecordsPort;
  cache: SessionRevocationCachePort;
}

/**
 * Ending somebody's sessions — all of them, all but one, the ones one sign-in
 * method minted, or a single named one.
 *
 * WHY EVERY VERB TOUCHES BOTH STORES. With `secondaryStorage` configured,
 * better-auth's `findSession` reads its Redis cache FIRST and short-circuits
 * before the database. Deleting the Postgres row alone is therefore invisible
 * to it: the person stays signed in, on a cached session and a cached user
 * object, until the entry expires — up to thirty days (`session.expiresIn`).
 * So a revocation clears the cache and then deletes the rows, and it is the
 * cache half that makes it take effect now.
 *
 * better-auth's own `revoke*` endpoints all operate on the CALLER's session
 * rather than a named person's, which is why none of them serves an admin
 * kicking somebody else out; its `internalAdapter.deleteSessions` handles both
 * stores but is not public API. This is that logic, over ports.
 *
 * The cache is best-effort throughout. A cache we could not clear delays the
 * revocation to the entry's TTL; it does not cancel it, so the rows still go
 * and the failure is logged rather than raised. The rows are the truth, which
 * is also why every verb sweeps them for tokens the index never listed: the
 * index is written as a convenience at sign-in, and a stale one would
 * otherwise leave a cached session behind.
 */
export class SessionRevocationService {
  constructor(private readonly deps: SessionRevocationServiceDeps) {}

  /**
   * End every session this person holds.
   *
   * The widest instrument, and the one a password reset and a deactivation
   * both use: they name the person and nothing else, because both are recovery
   * from an account somebody may have lost control of, and narrowing either
   * would leave an attacker's session in place.
   */
  async revokeAll({ userId }: { userId: string }): Promise<void> {
    const cleared = new Set<string>();
    try {
      const indexed = await this.deps.cache.readIndex({ userId });
      for (const session of indexed ?? []) {
        await this.deps.cache.dropSessions({ tokens: [session.token] });
        cleared.add(session.token);
      }
      await this.deps.cache.dropIndex({ userId });

      const missed = (
        await this.deps.records.findTokensForUser({ userId })
      ).filter((token) => !cleared.has(token));
      if (missed.length > 0) {
        await this.deps.cache.dropSessions({ tokens: missed });
      }
    } catch (error) {
      logger.error(
        { error, userId },
        "could not clear the session cache while ending every session; the rows are still being deleted",
      );
    }

    const deleted = await this.deps.records.deleteAllForUser({ userId });
    logger.info(
      { userId, deleted, cacheCleared: cleared.size },
      "ended every session for a person",
    );
  }

  /**
   * End every session this person holds EXCEPT the one they are asking from.
   *
   * What a password change does: other devices and any stolen session are
   * signed out while the tab that just re-authenticated keeps working.
   *
   * The session to keep is named by ROW ID rather than by token, because that
   * is what a request holds — a tRPC mutation reads `ctx.session.sessionId`
   * from the compat layer, never a fresh better-auth cookie — and because the
   * delete is keyed on it. The token is looked up here only so the cached
   * entry behind the kept session survives.
   */
  async revokeOthers({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<void> {
    const keepToken = await this.deps.records.findTokenForSession({
      sessionId: keepSessionId,
    });

    try {
      const indexed = (await this.deps.cache.readIndex({ userId })) ?? [];
      const kept = indexed.filter((session) => session.token === keepToken);
      const dropped = indexed
        .filter((session) => session.token !== keepToken)
        .map((session) => session.token);
      if (dropped.length > 0) {
        await this.deps.cache.dropSessions({ tokens: dropped });
      }
      if (kept.length > 0) {
        await this.deps.cache.writeIndex({ userId, sessions: kept });
      } else {
        await this.deps.cache.dropIndex({ userId });
      }

      const others = await this.deps.records.findTokensForUserExcept({
        userId,
        keepSessionId,
      });
      if (others.length > 0) {
        await this.deps.cache.dropSessions({ tokens: others });
      }
    } catch (error) {
      logger.error(
        { error, userId, keepSessionId },
        "could not clear the session cache while ending a person's other sessions; the rows are still being deleted",
      );
    }

    const deleted = await this.deps.records.deleteForUserExcept({
      userId,
      keepSessionId,
    });
    logger.info(
      { userId, keepSessionId, deleted },
      "ended every other session for a person",
    );
  }

  /**
   * End the sessions ONE sign-in method minted (D06).
   *
   * `Session.identifierId` records which method signed a session in. Nothing
   * reads it to decide whether a session is valid — which is exactly why it is
   * safe to end sessions by it: the column is evidence about a sign-in, and
   * this is the one place that acts on that evidence.
   *
   * A person signed in on two devices through two methods loses one device and
   * keeps the other. Sessions with a null `identifierId` — every session that
   * predates the column, and any mint we could not attribute — are left alone,
   * because "we do not know which method minted this" is not a reason to end
   * it. An operator who means all of them has {@link revokeAll}.
   *
   * The index is REWRITTEN here rather than dropped: the sessions this leaves
   * alone are still live, and they are still listed.
   */
  async revokeForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }> {
    const doomed = await this.deps.records.findForIdentifier({
      userId,
      identifierId,
    });
    if (doomed.length === 0) return { ended: 0 };

    const doomedTokens = doomed.map((session) => session.sessionToken);
    try {
      const indexed = await this.deps.cache.readIndex({ userId });
      if (indexed !== null) {
        const remaining = indexed.filter(
          (session) => !doomedTokens.includes(session.token),
        );
        if (remaining.length > 0) {
          await this.deps.cache.writeIndex({ userId, sessions: remaining });
        } else {
          await this.deps.cache.dropIndex({ userId });
        }
      }
      await this.deps.cache.dropSessions({ tokens: doomedTokens });
    } catch (error) {
      logger.error(
        { error, userId, identifierId },
        "could not clear the session cache while ending one sign-in method's sessions; the rows are still being deleted",
      );
    }

    const ended = await this.deps.records.deleteByIds({
      ids: doomed.map((session) => session.id),
    });
    logger.info(
      { userId, identifierId, deleted: ended },
      "ended the sessions one sign-in method minted",
    );
    return { ended };
  }

  /**
   * End the ONE session a token names — what signing out does.
   *
   * The row is deleted first and the cache after, the opposite of the wider
   * verbs, because the person doing this is holding the cookie: the request
   * that follows carries no session token at all, so there is no window for a
   * cached read to answer from.
   *
   * The user id is taken from the caller rather than from the row, so a token
   * whose row has already gone still clears that person's index.
   */
  async revokeOne({
    token,
    userId,
  }: {
    token: string;
    userId: string;
  }): Promise<void> {
    try {
      await this.deps.records.deleteByToken({ token });
    } catch (error) {
      logger.warn(
        { error, userId },
        "could not delete the session row while signing somebody out; the cached session is still being cleared",
      );
    }

    try {
      await this.deps.cache.dropSessions({ tokens: [token] });
      await this.deps.cache.dropIndex({ userId });
    } catch (error) {
      logger.warn(
        { error, userId },
        "could not clear the cached session while signing somebody out",
      );
    }
  }
}
