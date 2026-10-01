import {
  browserSessionImpersonationSchema,
  browserSessionInventoryEntrySchema,
  browserSessionSchema,
  SessionIsCurrentError,
  verifiedBrowserSessionSchema,
  type BrowserSession,
  type BrowserSessionResolution,
  type BrowserSessionInventoryEntry,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import {
  signedInWithFor,
  signInMethodLabelFor,
  signInProvedSecondFactor,
  type IdentityEmailService,
  type SignedInWith,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { AuthSessionCacheRepository } from "../repositories/auth-session-cache.repository.ts";
import type {
  AuthSessionRepository,
  StoredBrowserSession,
} from "../repositories/auth-session.repository.ts";
import type { SessionBoundService } from "./session-bound.service.ts";

const CACHE_PREFIX = "better-auth:";
const logger = createLogger("langwatch:auth:session-lifecycle");
const activeSessionsKey = (userId: string) => `${CACHE_PREFIX}active-sessions-${userId}`;
const tokenCacheKey = (token: string) => `${CACHE_PREFIX}${token}`;

type CachedSession = { token: string; expiresAt: number };

/** How long a person's stored name, address and status are trusted on a session read. */
export const SESSION_PERSON_TTL_MS = 30_000;
const MAX_CACHED_PEOPLE = 10_000;

/** What the browser-session half of the module is built from. */
export interface BrowserSessionDeps {
  sessions: AuthSessionRepository;
  /** Absent where the deployment composed no cache: the database still answers. */
  cache: AuthSessionCacheRepository | null;
  /** Absent until the front-door wiring lane lands; the read then falls back
   * to the stored user's own address, per the chain below. */
  identityEmails: IdentityEmailService | undefined;
  users: UserApi;
  /** The organization's browser-session window (GAC-10), asked here because
   *  this is where a session becomes an identity and the row is already read. */
  sessionBound: SessionBoundService;
  now(): Instant;
}

/** Browser session reads and revocation, over the rows this module owns. */
export class BrowserSessionService {
  static create(deps: BrowserSessionDeps): BrowserSessionService {
    return new BrowserSessionService(deps);
  }

  readonly #people = new Map<string, { value: Promise<SessionPerson>; until: number }>();

  private constructor(private readonly deps: BrowserSessionDeps) {}

  countSignedInUsers(input: { at: number }): Promise<number> {
    return this.deps.sessions.countSignedInUsers(input);
  }

  countSignedInUsersAmong(input: { userIds: readonly string[]; at: number }): Promise<number> {
    return this.deps.sessions.countSignedInUsersAmong(input);
  }

  async resolveBrowserSession(input: {
    verified: VerifiedBrowserSession;
  }): Promise<BrowserSessionResolution> {
    const verified = verifiedBrowserSessionSchema.parse(input.verified);

    const stored = await this.deps.sessions.findById({ id: verified.session.id });
    if (!stored) return { kind: "anonymous" };

    if (await this.pastItsWindow({ stored })) return { kind: "anonymous" };

    const { user, identityEmail } = await this.person({ userId: verified.user.id });
    const session = browserSessionSchema.parse({
      user: {
        id: verified.user.id,
        name: verified.user.name ?? null,
        email:
          (identityEmail?.kind === "resolved" ? identityEmail.email : null) ??
          user?.email ??
          verified.user.email ??
          null,
        image: verified.user.image ?? null,
        pendingSsoSetup: verified.user.pendingSsoSetup ?? false,
      },
      expires: verified.session.expiresAt.toISOString(),
      sessionId: verified.session.id,
    });

    return { kind: "signed_in", session: await this.asImpersonated({ stored, session }) };
  }

  /**
   * The stored person behind a session, remembered briefly: a page load asks once per request,
   * and none of it decides access. Revocation stays with the session row, read every time.
   */
  private person({ userId }: { userId: string }): Promise<SessionPerson> {
    const nowMs = this.deps.now().epochMilliseconds;
    const remembered = this.#people.get(userId);
    if (remembered && remembered.until > nowMs) return remembered.value;

    const value = Promise.all([
      this.deps.users.findById({ id: userId }),
      this.deps.identityEmails?.resolveEmail({ userId }),
    ]).then(([user, identityEmail]) => ({ user, identityEmail }));
    // A failed read is never remembered: the next request asks again.
    value.catch(() => {
      if (this.#people.get(userId)?.value === value) this.#people.delete(userId);
    });
    if (this.#people.size >= MAX_CACHED_PEOPLE) {
      const oldest = this.#people.keys().next().value;
      if (oldest !== void 0) this.#people.delete(oldest);
    }
    this.#people.set(userId, { value, until: nowMs + SESSION_PERSON_TTL_MS });

    return value;
  }

  /**
   * The same session seen as whoever is being browsed AS, or unchanged when
   * nobody is. An expired impersonation and a retired target both give the
   * signed-in session back: the back office renders as who is actually there.
   */
  private async asImpersonated({
    stored,
    session,
  }: {
    stored: StoredBrowserSession;
    session: BrowserSession;
  }): Promise<BrowserSession> {
    const impersonation = browserSessionImpersonationSchema.safeParse(stored.impersonating);
    if (!impersonation.success) return session;
    const impersonationExpired =
      Temporal.Instant.compare(fromDate(impersonation.data.expires), this.deps.now()) <= 0;
    if (impersonationExpired) return session;

    const { user: impersonatedUser, identityEmail } = await this.person({
      userId: impersonation.data.id,
    });
    if (!impersonatedUser || impersonatedUser.deactivatedAt !== null) {
      return session;
    }

    return browserSessionSchema.parse({
      ...session,
      user: {
        id: impersonation.data.id,
        name: impersonation.data.name ?? null,
        email:
          (identityEmail?.kind === "resolved" ? identityEmail.email : null) ??
          impersonatedUser.email ??
          impersonation.data.email ??
          null,
        image: impersonation.data.image ?? null,
        pendingSsoSetup: false,
        impersonator: {
          id: session.user.id,
          name: session.user.name ?? null,
          email: session.user.email ?? null,
          image: session.user.image ?? null,
        },
      },
    });
  }

  /**
   * Whether this session is past its organization's window, destroying it if
   * so: a session honoured in one place and refused in another has not
   * ended. A destroy that fails still refuses the caller.
   */
  private async pastItsWindow({ stored }: { stored: StoredBrowserSession }): Promise<boolean> {
    const verdict = await this.deps.sessionBound.enforce({
      session: {
        id: stored.id,
        userId: stored.userId,
        createdAt: stored.createdAt,
        lastSeenAt: stored.lastSeenAt,
        updatedAt: stored.updatedAt,
      },
    });
    if (verdict.withinBound) return false;

    try {
      await this.revokeBrowserSession({ sessionId: stored.id });
    } catch (error) {
      logger.warn(
        { error, sessionId: stored.id, reason: verdict.reason },
        "could not end a session past its organization's window; it is refused to the caller regardless",
      );
    }

    return true;
  }

  /**
   * Ends every session these people hold that is already past its window, each
   * judged by `enforce`, so a member of two organizations meets the strictest
   * bound. specs/identity/org-session-lifetime.feature
   */
  async endSessionsPastWindow({ userIds }: { userIds: readonly string[] }): Promise<number> {
    this.deps.sessionBound.forget();
    let ended = 0;
    for (const userId of userIds) {
      for (const stored of await this.deps.sessions.findStoredForUser({ userId })) {
        if (await this.pastItsWindow({ stored })) ended += 1;
      }
    }

    return ended;
  }

  /** How one of this person's own sessions signed in; `unknown` for any other. */
  async getSignedInWith({
    userId,
    sessionId,
  }: {
    userId: string;
    sessionId: string;
  }): Promise<SignedInWith> {
    const records = await this.deps.sessions.findForUser({ userId });
    const session = records.find((record) => record.id === sessionId);

    return signedInWithFor({ amr: session?.amr });
  }

  /**
   * What this person is signed in on, newest first. Nothing here reads a
   * token: the list is evidence about sign-ins, and a token on it would be a
   * credential on a screen.
   */
  async listBrowserSessions({
    userId,
    currentSessionId,
  }: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<readonly BrowserSessionInventoryEntry[]> {
    const records = await this.deps.sessions.findForUser({ userId });

    return records.map((record) =>
      browserSessionInventoryEntrySchema.parse({
        sessionId: record.id,
        identifierId: record.identifierId,
        method: signInMethodLabelFor({ amr: record.amr }),
        secondFactorProven: signInProvedSecondFactor(record.amr),
        ipAddress: record.ipAddress,
        userAgent: record.userAgent,
        signedInAt: toDate(record.createdAt).toISOString(),
        lastActiveAt: toDate(record.updatedAt).toISOString(),
        expiresAt: toDate(record.expires).toISOString(),
        current: record.id === currentSessionId,
      }),
    );
  }

  /**
   * The session is found in the caller's OWN list rather than deleted by id,
   * so naming somebody else's session ends nothing rather than ending theirs.
   */
  async endBrowserSession({
    userId,
    sessionId,
    currentSessionId,
  }: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<{ ended: number }> {
    if (currentSessionId && sessionId === currentSessionId) {
      throw new SessionIsCurrentError();
    }

    const records = await this.deps.sessions.findForUser({ userId });
    if (!records.some((record) => record.id === sessionId)) return { ended: 0 };

    await this.clearCachedSessions({ userId });
    const ended = await this.deps.sessions.deleteById({ id: sessionId });
    logger.info({ ended, sessionId, userId }, "Ended one of a person's own browser sessions");

    return { ended };
  }

  /**
   * Scoped to the person: the user id comes from the caller, never the
   * identifier, so naming somebody else's identifier ends nothing.
   */
  async endBrowserSessionsForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }> {
    const records = await this.deps.sessions.findForUser({ userId });
    const minted = records.filter((record) => record.identifierId === identifierId);
    if (minted.length === 0) return { ended: 0 };

    let ended = 0;
    for (const record of minted) {
      ended += await this.deps.sessions.deleteById({ id: record.id });
    }
    await this.clearCachedSessions({ userId });
    logger.info({ ended, identifierId, userId }, "Ended the sessions one sign-in method minted");

    return { ended };
  }

  async revokeAllBrowserSessions({ userId }: { userId: string }): Promise<void> {
    await this.clearCachedSessions({ userId });
    const deleted = await this.deps.sessions.deleteAllForUser({ userId });
    logger.info({ deleted, userId }, "Revoked all browser sessions for user");
  }

  async revokeBrowserSession({ sessionId }: { sessionId: string }): Promise<void> {
    const session = await this.deps.sessions.findById({ id: sessionId });
    if (!session) {
      return;
    }

    await this.clearCachedSessions({ userId: session.userId });
    const deleted = await this.deps.sessions.deleteById({ id: sessionId });
    logger.info({ deleted, sessionId, userId: session.userId }, "Revoked browser session");
  }

  async revokeOtherBrowserSessions({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<void> {
    const keep = await this.deps.sessions.findById({ id: keepSessionId });
    await this.clearCachedSessions({ userId, keepToken: keep?.sessionToken });
    const deleted = await this.deps.sessions.deleteOthersForUser({ userId, keepSessionId });
    logger.info({ deleted, keepSessionId, userId }, "Revoked other browser sessions for user");
  }

  private async clearCachedSessions({
    userId,
    keepToken,
  }: {
    userId: string;
    keepToken?: string;
  }): Promise<void> {
    const cache = this.deps.cache;
    if (!cache) {
      return;
    }

    try {
      const indexKey = activeSessionsKey(userId);
      const cached = (await cache.findValues({ key: indexKey })).flatMap(parseCachedSessions);
      const retained = cached.filter(({ token }) => token === keepToken);
      for (const { token } of cached) {
        if (token !== keepToken) {
          await cache.delete({ key: tokenCacheKey(token) });
        }
      }

      for (const token of await this.deps.sessions.findTokensForUser({ userId })) {
        if (token !== keepToken) {
          await cache.delete({ key: tokenCacheKey(token) });
        }
      }

      // Better Auth's own lifetime for this index: its furthest live session.
      const furthest = Math.max(0, ...retained.map(({ expiresAt }) => expiresAt));
      const ttlSeconds = Math.ceil((furthest - this.deps.now().epochMilliseconds) / 1_000);
      if (ttlSeconds > 0) {
        await cache.set({ key: indexKey, value: JSON.stringify(retained), ttlSeconds });
      } else {
        await cache.delete({ key: indexKey });
      }
    } catch (error) {
      logger.error(
        { error, userId },
        "Failed to clear Better Auth session cache during revocation",
      );
    }
  }
}

type SessionPerson = {
  user: Awaited<ReturnType<UserApi["findById"]>>;
  identityEmail: Awaited<ReturnType<IdentityEmailService["resolveEmail"]>> | undefined;
};

function parseCachedSessions(value: string): CachedSession[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item): CachedSession[] => {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof item.token === "string" &&
        typeof item.expiresAt === "number"
      ) {
        return [{ token: item.token, expiresAt: item.expiresAt }];
      }

      return [];
    });
  } catch {
    return [];
  }
}
