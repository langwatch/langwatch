import {
  AuthService as AuthCapability,
  browserSessionImpersonationSchema,
  browserSessionSchema,
  verifiedBrowserSessionSchema,
  type BrowserSession,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import type { UserService } from "@langwatch/user-contract";
import type { IdentityEmailService } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { AuthClockPort } from "../ports/auth-clock.port";
import type { AuthSecondaryStorePort } from "../ports/auth-secondary-store.port";
import type { AuthSessionRepository } from "../repositories/auth-session.repository";

const CACHE_PREFIX = "better-auth:";
const logger = createLogger("langwatch:auth:session-lifecycle");
const activeSessionsKey = (userId: string) => `${CACHE_PREFIX}active-sessions-${userId}`;
const tokenCacheKey = (token: string) => `${CACHE_PREFIX}${token}`;

type CachedSession = { token: string; expiresAt: number };

function parseCachedSessions(value: string | null): CachedSession[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
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

/** One process-owned service for browser session reads and revocation. */
export class AuthService extends AuthCapability {
  static create(options: {
    clock: AuthClockPort;
    repository: AuthSessionRepository;
    secondaryStore: AuthSecondaryStorePort | null;
    identityEmails: IdentityEmailService;
    users: UserService;
  }): AuthService {
    return new AuthService(options);
  }

  private constructor(
    private readonly options: {
      clock: AuthClockPort;
      repository: AuthSessionRepository;
      secondaryStore: AuthSecondaryStorePort | null;
      identityEmails: IdentityEmailService;
      users: UserService;
    },
  ) {
    super();
  }

  async tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    const verified = input.verified ? verifiedBrowserSessionSchema.parse(input.verified) : null;
    if (!verified) return null;

    const stored = await this.options.repository.tryFindById({ id: verified.session.id });
    if (!stored) return null;

    const user = await this.options.users.tryFindById({ id: verified.user.id });
    const session = browserSessionSchema.parse({
      user: {
        id: verified.user.id,
        name: verified.user.name ?? null,
        email:
          (await this.options.identityEmails.resolveEmail({ userId: verified.user.id })) ??
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
    if (!impersonation.success || impersonation.data.expires <= this.options.clock.now()) {
      return session;
    }

    const targetIsActive = await this.options.repository.isUserActive({
      id: impersonation.data.id,
    });
    if (!targetIsActive) return session;

    const impersonatedUser = await this.options.users.tryFindById({
      id: impersonation.data.id,
    });
    return browserSessionSchema.parse({
      ...session,
      user: {
        id: impersonation.data.id,
        name: impersonation.data.name ?? null,
        email:
          (await this.options.identityEmails.resolveEmail({ userId: impersonation.data.id })) ??
          impersonatedUser?.email ??
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

  async revokeAllBrowserSessions({ userId }: { userId: string }): Promise<void> {
    await this.clearCachedSessions({ userId });
    const deleted = await this.options.repository.deleteAllForUser({ userId });
    logger.info({ deleted, userId }, "Revoked all browser sessions for user");
  }

  async revokeBrowserSession({ sessionId }: { sessionId: string }): Promise<void> {
    const session = await this.options.repository.tryFindById({ id: sessionId });
    if (!session) return;

    await this.clearCachedSessions({ userId: session.userId });
    const deleted = await this.options.repository.deleteById({ id: sessionId });
    logger.info({ deleted, sessionId, userId: session.userId }, "Revoked browser session");
  }

  async revokeOtherBrowserSessions({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<void> {
    const keep = await this.options.repository.tryFindById({ id: keepSessionId });
    await this.clearCachedSessions({ userId, keepToken: keep?.sessionToken });
    const deleted = await this.options.repository.deleteOthersForUser({ userId, keepSessionId });
    logger.info({ deleted, keepSessionId, userId }, "Revoked other browser sessions for user");
  }

  private async clearCachedSessions({
    userId,
    keepToken,
  }: {
    userId: string;
    keepToken?: string;
  }): Promise<void> {
    const store = this.options.secondaryStore;
    if (!store) return;

    try {
      const indexKey = activeSessionsKey(userId);
      const cached = parseCachedSessions(await store.get({ key: indexKey }));
      const retained = cached.filter(({ token }) => token === keepToken);
      for (const { token } of cached) {
        if (token !== keepToken) await store.delete({ key: tokenCacheKey(token) });
      }

      for (const token of await this.options.repository.listTokensForUser({ userId })) {
        if (token !== keepToken) await store.delete({ key: tokenCacheKey(token) });
      }

      if (keepToken && retained.length > 0) {
        await store.set({ key: indexKey, value: JSON.stringify(retained) });
      } else {
        await store.delete({ key: indexKey });
      }
    } catch (error) {
      logger.error(
        { error, userId },
        "Failed to clear Better Auth session cache during revocation",
      );
    }
  }
}
