import {
  browserSessionImpersonationSchema,
  browserSessionInventoryEntrySchema,
  browserSessionSchema,
  SessionIsCurrentError,
  verifiedBrowserSessionSchema,
  type BrowserSession,
  type BrowserSessionInventoryEntry,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import {
  signInMethodLabelFor,
  signInProvedSecondFactor,
  type IdentityEmailService,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { AuthSessionCacheRepository } from "../repositories/auth-session-cache.repository.ts";
import type { AuthSessionRepository } from "../repositories/auth-session.repository.ts";

const CACHE_PREFIX = "better-auth:";
const logger = createLogger("langwatch:auth:session-lifecycle");
const activeSessionsKey = (userId: string) => `${CACHE_PREFIX}active-sessions-${userId}`;
const tokenCacheKey = (token: string) => `${CACHE_PREFIX}${token}`;

type CachedSession = { token: string; expiresAt: number };

/** What the browser-session half of the module is built from. */
export interface BrowserSessionDeps {
  sessions: AuthSessionRepository;
  /** Absent where the deployment composed no cache: the database still answers. */
  cache: AuthSessionCacheRepository | null;
  /** Absent until the front-door wiring lane lands; the read then falls back
   * to the stored user's own address, per the chain below. */
  identityEmails: IdentityEmailService | undefined;
  users: UserApi;
  now(): Instant;
}

/** Browser session reads and revocation, over the rows this module owns. */
export class BrowserSessionService {
  static create(deps: BrowserSessionDeps): BrowserSessionService {
    return new BrowserSessionService(deps);
  }

  private constructor(private readonly deps: BrowserSessionDeps) {}

  async tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    const verified = input.verified ? verifiedBrowserSessionSchema.parse(input.verified) : null;
    if (!verified) {
      return null;
    }

    const stored = await this.deps.sessions.findById({ id: verified.session.id });
    if (!stored) {
      return null;
    }

    const user = await this.deps.users.findById({ id: verified.user.id });
    const session = browserSessionSchema.parse({
      user: {
        id: verified.user.id,
        name: verified.user.name ?? null,
        email:
          (await this.deps.identityEmails?.tryResolveEmail({ userId: verified.user.id })) ??
          user?.email ??
          verified.user.email ??
          null,
        image: verified.user.image ?? null,
        pendingSsoSetup: verified.user.pendingSsoSetup ?? false,
      },
      expires: verified.session.expiresAt.toISOString(),
      sessionId: verified.session.id,
    });

    const impersonation = browserSessionImpersonationSchema.safeParse(stored.impersonating);
    if (!impersonation.success) return session;
    const impersonationExpired =
      Temporal.Instant.compare(fromDate(impersonation.data.expires), this.deps.now()) <= 0;
    if (impersonationExpired) return session;

    // The person being browsed as, read through the ONE directory this process
    // resolves anybody through: a retired account stops the impersonation here
    // rather than rendering the back office as somebody who is gone.
    const impersonatedUser = await this.deps.users.findById({ id: impersonation.data.id });
    if (!impersonatedUser || impersonatedUser.deactivatedAt !== null) {
      return session;
    }

    return browserSessionSchema.parse({
      ...session,
      user: {
        id: impersonation.data.id,
        name: impersonation.data.name ?? null,
        email:
          (await this.deps.identityEmails?.tryResolveEmail({ userId: impersonation.data.id })) ??
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
      const cached = parseCachedSessions(await cache.findValue({ key: indexKey }));
      const retained = cached.filter(({ token }) => token === keepToken);
      for (const { token } of cached) {
        if (token !== keepToken) {
          await cache.delete({ key: tokenCacheKey(token) });
        }
      }

      for (const token of await this.deps.sessions.listTokensForUser({ userId })) {
        if (token !== keepToken) {
          await cache.delete({ key: tokenCacheKey(token) });
        }
      }

      if (keepToken && retained.length > 0) {
        await cache.set({ key: indexKey, value: JSON.stringify(retained) });
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

function parseCachedSessions(value: string | null): CachedSession[] {
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
