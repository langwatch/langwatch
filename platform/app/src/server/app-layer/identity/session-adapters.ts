import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { tryGetApp } from "~/server/app-layer/app";
import type {
  ProviderAssertionPort,
  SessionIdentifierPort,
} from "./session-claims.service";
import type {
  SessionCachePort,
  SessionRecord,
  SessionRecordsPort,
} from "./session-inventory.service";
import type {
  CachedSession,
  RevocableSession,
  SessionRevocationCachePort,
  SessionRevocationRecordsPort,
} from "./session-revocation.service";

const logger = createLogger("langwatch:identity:session-claims");

/**
 * The reads and writes behind what a session records, behind ending the
 * sessions one sign-in method minted (D06), and behind revocation. Prisma and
 * Redis live here so the services above stay decisions.
 */

/**
 * Which `Identifier` row a provider's sign-in belongs to.
 *
 * A live identifier only: a detached one describes a method the person no
 * longer holds, and attributing a fresh session to it would make
 * per-identifier revocation miss the session it was meant to end. The newest
 * wins where a person somehow holds two for one provider, which is what a
 * re-attach after a detach looks like in the projection.
 */
export class PrismaSessionIdentifiers implements SessionIdentifierPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findIdentifierIdFor({
    userId,
    provider,
  }: {
    userId: string;
    provider: string;
  }): Promise<string | null> {
    const identifier = await this.prisma.identifier.findFirst({
      where: { userId, provider, detachedAt: null },
      orderBy: { attachedAt: "desc" },
      select: { id: true },
    });
    return identifier?.id ?? null;
  }
}

/**
 * What the identity provider asserted, read off the identity token it issued.
 *
 * The `amr` claim is the provider's own statement about what it checked, and
 * it is the ONLY thing that can satisfy an organization's requirement for
 * somebody who signs in through a connection. So it is read from the token
 * rather than configured on our side: a connection reconfigured at the
 * provider this morning starts asserting this morning, with nothing here to
 * update.
 *
 * Every failure answers the empty list. A token we cannot read, a provider
 * that issued none, a claim that is not an array - none of them is an error
 * the person can act on, and all of them mean the same thing: nothing was
 * asserted, so nothing is inferred.
 */
export class IdTokenProviderAssertions implements ProviderAssertionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async assertedFactorsFor({
    userId,
    provider,
  }: {
    userId: string;
    provider: string;
  }): Promise<readonly string[]> {
    const account = await this.prisma.account.findFirst({
      where: { userId, provider },
      orderBy: { updatedAt: "desc" },
      select: { id_token: true },
    });
    if (!account?.id_token) return [];
    return amrClaimIn({ idToken: account.id_token });
  }
}

/**
 * The `amr` claim of a signed identity token.
 *
 * The signature is NOT verified here, deliberately: better-auth verified it
 * before it wrote the row, and re-verifying would need the provider's keys in
 * a module whose job is reading a claim off a row we already trust. What this
 * must not do is throw - a malformed token is an empty assertion.
 */
export function amrClaimIn({
  idToken,
}: {
  idToken: string;
}): readonly string[] {
  const payload = idToken.split(".")[1];
  if (!payload) return [];
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    if (typeof decoded !== "object" || decoded === null) return [];
    const amr = (decoded as { amr?: unknown }).amr;
    if (!Array.isArray(amr)) return [];
    return amr.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

/** The session rows themselves. */
export class PrismaSessionRecords implements SessionRecordsPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly SessionRecord[]> {
    return this.prisma.session.findMany({
      where: { userId, expires: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: SESSION_RECORD_SELECT,
    });
  }

  async listForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<readonly SessionRecord[]> {
    // The user id is part of the predicate even though the identifier already
    // implies one: a caller that named somebody else's identifier ends
    // nothing rather than ending their sessions.
    return this.prisma.session.findMany({
      where: { userId, identifierId },
      select: SESSION_RECORD_SELECT,
    });
  }

  async deleteByIds({ ids }: { ids: readonly string[] }): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.session.deleteMany({
      where: { id: { in: [...ids] } },
    });
    return result.count;
  }
}

const SESSION_RECORD_SELECT = {
  id: true,
  sessionToken: true,
  identifierId: true,
  amr: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  // Rolled once a day by better-auth's `updateAge` on a session that is still
  // being used, which is what makes it readable as activity.
  updatedAt: true,
  expires: true,
} as const;

/**
 * The keys better-auth's `secondaryStorage` adapter writes, spelled here and
 * nowhere else in the app (`specs/identity/identity-service-layering.feature`).
 * The adapter prefixes every key it is handed with `better-auth:`, and the two
 * keys it writes for a session are the session itself, under its token, and
 * the per-user index of the tokens that are live.
 */
const cachedSessionKey = ({ token }: { token: string }) =>
  `better-auth:${token}`;
const activeSessionIndexKey = ({ userId }: { userId: string }) =>
  `better-auth:active-sessions-${userId}`;

/** The App's Redis, or null on a deployment that runs without one. */
const sessionCacheConnection = () => tryGetApp()?.redis ?? null;

/**
 * better-auth's session cache, cleared for the tokens that are about to stop
 * being valid.
 *
 * The same keys {@link RedisSessionRevocationCache} clears, for the same
 * reason: better-auth reads the cache before the database, so a deleted row
 * alone is invisible to it for as long as thirty days.
 */
export class RedisSessionCache implements SessionCachePort {
  async dropTokens({
    userId,
    tokens,
  }: {
    userId: string;
    tokens: readonly string[];
  }): Promise<void> {
    const redis = sessionCacheConnection();
    if (!redis) return;
    try {
      for (const token of tokens) {
        await redis.del(cachedSessionKey({ token }));
      }
      // The index is a write-time convenience, not the truth. Dropping it
      // whole costs one extra database read on this person's next request and
      // cannot leave a revoked token listed as live.
      await redis.del(activeSessionIndexKey({ userId }));
    } catch (error) {
      // The rows are still going. A cache we could not clear delays the
      // revocation; it does not fail it, and saying so is what makes the
      // delay diagnosable rather than mysterious.
      logger.error(
        { error, userId, tokenCount: tokens.length },
        "could not clear the session cache while ending sessions for one sign-in method; the rows are still being deleted",
      );
    }
  }
}

/**
 * The same cache, as revocation reads and rewrites it.
 *
 * Separate from {@link RedisSessionCache} because the error policy differs and
 * not because the store does: these methods report a failure by throwing, and
 * `SessionRevocationService` is what decides that a cache it could not clear
 * delays a revocation rather than failing it.
 *
 * A deployment with no Redis reads as an empty cache and accepts every write:
 * there is nothing cached to leave a revoked person signed in, so absence is
 * an answer here rather than a failure.
 */
export class RedisSessionRevocationCache implements SessionRevocationCachePort {
  async readIndex({
    userId,
  }: {
    userId: string;
  }): Promise<readonly CachedSession[] | null> {
    const redis = sessionCacheConnection();
    if (!redis) return null;
    const stored = await redis.get(activeSessionIndexKey({ userId }));
    if (!stored) return null;
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (session): session is CachedSession =>
          typeof (session as CachedSession | null)?.token === "string",
      );
    } catch (error) {
      // An index we cannot read is an index we cannot trust, so it answers
      // the same as a missing one: the caller falls back to the session rows,
      // which is the safety net that makes the index optional in the first
      // place.
      logger.warn(
        { error, userId },
        "could not read the cached index of live sessions; falling back to the session rows",
      );
      return null;
    }
  }

  async writeIndex({
    userId,
    sessions,
  }: {
    userId: string;
    sessions: readonly CachedSession[];
  }): Promise<void> {
    const redis = sessionCacheConnection();
    if (!redis) return;
    await redis.set(
      activeSessionIndexKey({ userId }),
      JSON.stringify(sessions),
    );
  }

  async dropIndex({ userId }: { userId: string }): Promise<void> {
    const redis = sessionCacheConnection();
    if (!redis) return;
    await redis.del(activeSessionIndexKey({ userId }));
  }

  async dropSessions({ tokens }: { tokens: readonly string[] }): Promise<void> {
    const redis = sessionCacheConnection();
    if (!redis) return;
    for (const token of tokens) {
      await redis.del(cachedSessionKey({ token }));
    }
  }
}

/**
 * The session rows revocation deletes, and the tokens it has to clear from the
 * cache before it does.
 *
 * Every read here is deliberately unfiltered by expiry, unlike
 * {@link PrismaSessionRecords}: a cached session outlives the row's own expiry
 * window, so a token skipped for being expired is a token better-auth would
 * keep answering from.
 */
export class PrismaSessionRevocationRecords
  implements SessionRevocationRecordsPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findTokensForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly string[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      select: { sessionToken: true },
    });
    return sessions.map((session) => session.sessionToken);
  }

  async findTokensForUserExcept({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<readonly string[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, NOT: { id: keepSessionId } },
      select: { sessionToken: true },
    });
    return sessions.map((session) => session.sessionToken);
  }

  async findTokenForSession({
    sessionId,
  }: {
    sessionId: string;
  }): Promise<string | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { sessionToken: true },
    });
    return session?.sessionToken ?? null;
  }

  async findForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<readonly RevocableSession[]> {
    // The user id is part of the predicate even though the identifier already
    // implies one: a caller that named somebody else's identifier ends
    // nothing rather than ending their sessions.
    return this.prisma.session.findMany({
      where: { userId, identifierId },
      select: { id: true, sessionToken: true },
    });
  }

  async deleteAllForUser({ userId }: { userId: string }): Promise<number> {
    const result = await this.prisma.session.deleteMany({ where: { userId } });
    return result.count;
  }

  async deleteForUserExcept({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });
    return result.count;
  }

  async deleteByIds({ ids }: { ids: readonly string[] }): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.prisma.session.deleteMany({
      where: { id: { in: [...ids] } },
    });
    return result.count;
  }

  async deleteByToken({ token }: { token: string }): Promise<number> {
    // `deleteMany` rather than `delete` so a session that has already gone —
    // the ordinary case when somebody signs out twice — is a count of zero
    // rather than an exception to swallow.
    const result = await this.prisma.session.deleteMany({
      where: { sessionToken: token },
    });
    return result.count;
  }
}
