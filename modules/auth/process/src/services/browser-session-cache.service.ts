import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { AuthSessionCacheRepository } from "../repositories/auth-session-cache.repository.ts";
import type { AuthSessionRepository } from "../repositories/auth-session.repository.ts";

const CACHE_PREFIX = "better-auth:";
const logger = createLogger("langwatch:auth:session-lifecycle");
const activeSessionsKey = (userId: string) => `${CACHE_PREFIX}active-sessions-${userId}`;
const tokenCacheKey = (token: string) => `${CACHE_PREFIX}${token}`;

type CachedSession = { token: string; expiresAt: number };

/** What Better Auth's session cache is cleared through. */
interface BrowserSessionCacheDeps {
  sessions: Pick<AuthSessionRepository, "findTokensForUser">;
  /** Absent where the deployment composed no cache: there is then nothing to clear. */
  cache: AuthSessionCacheRepository | null;
  now(): Instant;
}

/** Better Auth's cached copies of a person's sessions, dropped when the rows are revoked. */
export class BrowserSessionCacheService {
  static create(deps: BrowserSessionCacheDeps): BrowserSessionCacheService {
    return new BrowserSessionCacheService(deps);
  }

  private constructor(private readonly deps: BrowserSessionCacheDeps) {}

  /** Read before the rows go: a deleted row no longer names its token. None without a cache. */
  async tokensToClear({ userId }: { userId: string }): Promise<string[]> {
    return this.deps.cache ? this.deps.sessions.findTokensForUser({ userId }) : [];
  }

  /** Drops the cached copies, logging a failure: the rows are already gone. */
  async clearCachedSessions({
    userId,
    tokens,
    keepToken,
  }: {
    userId: string;
    tokens: readonly string[];
    keepToken?: string;
  }): Promise<void> {
    try {
      await this.dropCachedSessions({ userId, tokens, keepToken });
    } catch (error) {
      logger.error(
        { error, userId },
        "Failed to clear Better Auth session cache during revocation",
      );
    }
  }

  /** Drops the cached copies except `keepToken`'s, and throws when the cache refuses. */
  async dropCachedSessions({
    userId,
    tokens,
    keepToken,
  }: {
    userId: string;
    tokens: readonly string[];
    keepToken?: string;
  }): Promise<void> {
    const cache = this.deps.cache;
    if (!cache) {
      return;
    }

    const indexKey = activeSessionsKey(userId);
    const cached = (await cache.findValues({ key: indexKey })).flatMap(parseCachedSessions);
    const retained = cached.filter(({ token }) => token === keepToken);
    for (const { token } of cached) {
      if (token !== keepToken) {
        await cache.delete({ key: tokenCacheKey(token) });
      }
    }

    for (const token of tokens) {
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
  }
}

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
