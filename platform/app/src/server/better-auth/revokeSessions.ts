import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { connection as redisConnection } from "~/server/redis";

const logger = createLogger("langwatch:better-auth:revoke");

type RedisConnection = NonNullable<typeof redisConnection>;

/**
 * Delete every cached session listed in the `active-sessions-` index and then
 * the index itself, appending each token it cleared to `cleared`.
 */
const clearCachedSessionsFromIndex = async ({
  redis,
  userId,
  cleared,
}: {
  redis: RedisConnection;
  userId: string;
  cleared: string[];
}): Promise<void> => {
  const indexKey = `better-auth:active-sessions-${userId}`;
  const indexJson = await redis.get(indexKey);
  if (!indexJson) return;

  try {
    const sessions = JSON.parse(indexJson) as Array<{ token: string }>;
    for (const s of sessions) {
      await redis.del(`better-auth:${s.token}`);
      cleared.push(s.token);
    }
  } catch (parseErr) {
    logger.warn(
      { err: parseErr, userId },
      "Failed to parse active-sessions index from Redis, falling back to DB scan",
    );
  }
  await redis.del(indexKey);
};

const clearCachedSessionsFromDb = async ({
  redis,
  prisma,
  userId,
  cleared,
}: {
  redis: RedisConnection;
  prisma: PrismaClient;
  userId: string;
  cleared: string[];
}): Promise<void> => {
  const dbSessions = await prisma.session.findMany({
    where: { userId },
    select: { sessionToken: true },
  });
  for (const s of dbSessions) {
    if (!cleared.includes(s.sessionToken)) {
      await redis.del(`better-auth:${s.sessionToken}`);
    }
  }
};

/**
 * Force-revoke ALL sessions for a user, clearing both the Postgres
 * `Session` table AND the BetterAuth Redis session cache.
 *
 * Why both? BetterAuth uses Redis as a primary read cache when
 * `secondaryStorage` is configured. The `findSession` function in
 * `node_modules/better-auth/dist/db/internal-adapter.mjs` reads the
 * cache FIRST and short-circuits before going to the DB. So a Prisma
 * `prisma.session.deleteMany({where:{userId}})` alone is invisible to
 * BetterAuth — the user stays "logged in" (cached session, cached user
 * object) until the cache TTL expires, which is up to 30 days
 * (`session.expiresIn`).
 *
 * BetterAuth's own `auth.api.revoke*` endpoints all operate on the
 * caller's current session, not on an arbitrary userId, so they aren't
 * usable from an admin context that's trying to kick another user out.
 * The internal `internalAdapter.deleteSessions(userId)` function handles
 * both stores correctly but is not part of BetterAuth's stable public
 * API. We replicate the same logic here against our shared
 * `redisConnection` (which BetterAuth uses via the `secondaryStorage`
 * adapter in `src/server/better-auth/index.ts`) and our Prisma client.
 *
 * Cache key format used by BetterAuth's secondaryStorage adapter (from
 * `src/server/better-auth/index.ts`): `better-auth:${key}`. The keys
 * BetterAuth writes are:
 *   - `${sessionToken}` → JSON-stringified `{session, user}`
 *   - `active-sessions-${userId}` → JSON array of `{token, expiresAt}`
 *
 * Used by:
 *   - tRPC `user.deactivate` mutation (force-logout deactivated users)
 *
 * Future use cases that should also call this:
 *   - Admin "kick session" UI
 *   - Any audit-driven session revocation flow
 */
export const revokeAllSessionsForUser = async ({
  prisma,
  userId,
}: {
  prisma: PrismaClient;
  userId: string;
}): Promise<void> => {
  // Step 1: clear the Redis cache. We try to use the `active-sessions-`
  // index first (faster, single read), but fall back to scanning the
  // Postgres `Session` table if the index is missing or stale.
  const cleared: string[] = [];
  if (redisConnection) {
    try {
      await clearCachedSessionsFromIndex({
        redis: redisConnection,
        userId,
        cleared,
      });

      // Always also scan Postgres for any session tokens that weren't in
      // the Redis index (the index is a write-time best-effort cache,
      // not a source of truth). This is the safety net.
      await clearCachedSessionsFromDb({
        redis: redisConnection,
        prisma,
        userId,
        cleared,
      });
    } catch (err) {
      logger.error(
        { err, userId },
        "Failed to clear Redis session cache during revocation; proceeding with DB delete",
      );
    }
  }

  // Step 2: delete the Postgres session rows.
  const result = await prisma.session.deleteMany({ where: { userId } });

  logger.info(
    { userId, deleted: result.count, redisCleared: cleared.length },
    "Revoked all sessions for user",
  );
};

/**
 * Delete every cached session in the `active-sessions-` index except the kept
 * one, and return the entries that survive so the caller can rewrite the index.
 */
const clearOtherCachedSessionsFromIndex = async ({
  redis,
  indexKey,
  userId,
  keepToken,
}: {
  redis: RedisConnection;
  indexKey: string;
  userId: string;
  keepToken: string | undefined;
}): Promise<Array<{ token: string; expiresAt: number }>> => {
  const indexJson = await redis.get(indexKey);
  const remainingTokens: Array<{ token: string; expiresAt: number }> = [];
  if (indexJson) {
    try {
      const sessions = JSON.parse(indexJson) as Array<{
        token: string;
        expiresAt: number;
      }>;
      for (const s of sessions) {
        if (s.token === keepToken) {
          remainingTokens.push(s);
        } else {
          await redis.del(`better-auth:${s.token}`);
        }
      }
    } catch (parseErr) {
      logger.warn(
        { err: parseErr, userId },
        "Failed to parse active-sessions index from Redis during partial revoke",
      );
    }
  }
  return remainingTokens;
};

const clearOtherCachedSessionsFromDb = async ({
  redis,
  prisma,
  userId,
  keepSessionId,
}: {
  redis: RedisConnection;
  prisma: PrismaClient;
  userId: string;
  keepSessionId: string;
}): Promise<void> => {
  const dbSessions = await prisma.session.findMany({
    where: { userId, NOT: { id: keepSessionId } },
    select: { sessionToken: true },
  });
  for (const s of dbSessions) {
    await redis.del(`better-auth:${s.sessionToken}`);
  }
};

/**
 * Force-revoke all sessions for a user EXCEPT the one identified by
 * `keepSessionId`. Used by self-service flows like password change,
 * where we want to log out other devices but keep the user's current
 * tab logged in.
 *
 * This is the moral equivalent of BetterAuth's `/revoke-other-sessions`
 * endpoint, but invocable from a tRPC mutation context (where we have
 * a `ctx.session` from the compat layer rather than a fresh BetterAuth
 * cookie middleware run). The keep-id approach also avoids needing to
 * thread request headers through to the BetterAuth API.
 */
export const revokeOtherSessionsForUser = async ({
  prisma,
  userId,
  keepSessionId,
}: {
  prisma: PrismaClient;
  userId: string;
  keepSessionId: string;
}): Promise<void> => {
  // Step 1: clear the Redis cache for all session tokens EXCEPT the one
  // we want to keep. We need the keep-session's token to compare.
  const keepSession = await prisma.session.findUnique({
    where: { id: keepSessionId },
    select: { sessionToken: true },
  });
  const keepToken = keepSession?.sessionToken;

  if (redisConnection) {
    try {
      const indexKey = `better-auth:active-sessions-${userId}`;
      const remainingTokens = await clearOtherCachedSessionsFromIndex({
        redis: redisConnection,
        indexKey,
        userId,
        keepToken,
      });
      // Rewrite the index with only the kept session, or delete if empty.
      if (remainingTokens.length > 0) {
        await redisConnection.set(indexKey, JSON.stringify(remainingTokens));
      } else {
        await redisConnection.del(indexKey);
      }

      // Safety net: scan Postgres for any session tokens not yet cleared.
      await clearOtherCachedSessionsFromDb({
        redis: redisConnection,
        prisma,
        userId,
        keepSessionId,
      });
    } catch (err) {
      logger.error(
        { err, userId, keepSessionId },
        "Failed to clear Redis session cache during partial revocation; proceeding with DB delete",
      );
    }
  }

  // Step 2: delete the other Postgres session rows.
  const result = await prisma.session.deleteMany({
    where: { userId, NOT: { id: keepSessionId } },
  });

  logger.info(
    { userId, keepSessionId, deleted: result.count },
    "Revoked all OTHER sessions for user",
  );
};
