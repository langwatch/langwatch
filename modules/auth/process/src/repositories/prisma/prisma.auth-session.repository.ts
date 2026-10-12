import type { SessionImpersonation } from "@langwatch/auth-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  AuthSessionRepository,
  BrowserSessionRecord,
  SessionExpiry,
  StoredBrowserSession,
} from "../auth-session.repository.ts";

const sessionSelect = {
  id: true,
  userId: true,
  sessionToken: true,
  actorUserId: true,
  subjectUserId: true,
  impersonationReason: true,
  impersonationExpiresAt: true,
  createdAt: true,
  lastSeenAt: true,
  updatedAt: true,
} as const;

type SessionRow = {
  id: string;
  userId: string;
  sessionToken: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  impersonationReason: string | null;
  impersonationExpiresAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  updatedAt: Date;
};

function storedSession(row: SessionRow): StoredBrowserSession {
  return {
    id: row.id,
    userId: row.userId,
    sessionToken: row.sessionToken,
    impersonation:
      row.actorUserId || row.subjectUserId || row.impersonationExpiresAt
        ? {
            actorUserId: row.actorUserId,
            subjectUserId: row.subjectUserId,
            reason: row.impersonationReason,
            expiresAt: row.impersonationExpiresAt ? fromDate(row.impersonationExpiresAt) : null,
          }
        : null,
    createdAt: fromDate(row.createdAt),
    lastSeenAt: row.lastSeenAt ? fromDate(row.lastSeenAt) : null,
    updatedAt: fromDate(row.updatedAt),
  };
}

/**
 * The `Session` table, which auth owns outright. Deletes go through
 * `deleteMany` rather than `delete` on purpose: revocation is idempotent —
 * two tabs signing out race — and `delete` would raise on an already-gone row.
 */
export class PrismaAuthSessionRepository
  extends PrismaRepository.for("Session")
  implements AuthSessionRepository
{
  static readonly create = this.factory((prisma) => new PrismaAuthSessionRepository(prisma));

  async countSignedInUsers({ at }: { at: number }): Promise<number> {
    const rows = await this.prisma.session.findMany({
      where: { expires: { gte: new Date(at) } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.length;
  }

  async countSignedInUsersAmong({
    userIds,
    at,
  }: {
    userIds: readonly string[];
    at: number;
  }): Promise<number> {
    if (userIds.length === 0) return 0;
    const rows = await this.prisma.session.findMany({
      where: { userId: { in: [...userIds] }, expires: { gte: new Date(at) } },
      select: { userId: true },
      distinct: ["userId"],
    });
    return rows.length;
  }

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    const row = await this.prisma.session.findUnique({ where: { id }, select: sessionSelect });

    return row ? storedSession(row) : null;
  }

  async findStoredForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly StoredBrowserSession[]> {
    const rows = await this.prisma.session.findMany({ where: { userId }, select: sessionSelect });

    return rows.map(storedSession);
  }

  async findForUser({ userId }: { userId: string }): Promise<readonly BrowserSessionRecord[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        identifierId: true,
        amr: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        expires: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      identifierId: row.identifierId,
      amr: row.amr,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: fromDate(row.createdAt),
      updatedAt: fromDate(row.updatedAt),
      expires: fromDate(row.expires),
    }));
  }

  async findTokensForUser({ userId }: { userId: string }): Promise<string[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      select: { sessionToken: true },
    });

    return sessions.map(({ sessionToken }) => sessionToken);
  }

  async deleteAllForUser({ userId }: { userId: string }): Promise<number> {
    const deleted = await this.prisma.session.deleteMany({ where: { userId } });

    return deleted.count;
  }

  async deleteById({ id }: { id: string }): Promise<number> {
    const deleted = await this.prisma.session.deleteMany({ where: { id } });

    return deleted.count;
  }

  async writeImpersonation({
    sessionId,
    claims,
  }: {
    sessionId: string;
    claims: SessionImpersonation;
  }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: {
        actorUserId: claims.actorUserId,
        subjectUserId: claims.subjectUserId,
        impersonationReason: claims.reason,
        impersonationExpiresAt: toDate(claims.expiresAt),
      },
    });
  }

  async clearImpersonation({ sessionId }: { sessionId: string }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: {
        actorUserId: null,
        subjectUserId: null,
        impersonationReason: null,
        impersonationExpiresAt: null,
      },
    });
  }

  async touch({ sessionId, at }: { sessionId: string; at: Instant }): Promise<void> {
    // `updateMany` rather than `update`: the session may have been revoked
    // between the read and this write, and a stamp is not worth raising over.
    await this.prisma.session.updateMany({
      where: { id: sessionId },
      data: { lastSeenAt: toDate(at) },
    });
  }

  async deleteOthersForUser({
    userId,
    keepSessionId,
  }: {
    userId: string;
    keepSessionId: string;
  }): Promise<number> {
    const deleted = await this.prisma.session.deleteMany({
      where: { userId, NOT: { id: keepSessionId } },
    });

    return deleted.count;
  }

  async findExpiryByToken({ token }: { token: string }): Promise<SessionExpiry[]> {
    const rows = await this.prisma.session.findMany({
      where: { sessionToken: token },
      select: { expires: true, userId: true },
    });

    return rows.map((row) => ({ expires: fromDate(row.expires), userId: row.userId }));
  }

  async findAmrForSession({ sessionId }: { sessionId: string }): Promise<string[]> {
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { amr: true },
    });

    return row ? [...row.amr] : [];
  }

  async findAmrForIdentifiers({
    userIds,
    identifierIds,
    at,
  }: {
    userIds: readonly string[];
    identifierIds: readonly string[];
    at: Instant;
  }): Promise<string[]> {
    if (userIds.length === 0 || identifierIds.length === 0) return [];

    const rows = await this.prisma.session.findMany({
      where: {
        userId: { in: [...userIds] },
        identifierId: { in: [...identifierIds] },
        expires: { gt: toDate(at) },
      },
      select: { amr: true },
    });

    return [...new Set(rows.flatMap((row) => row.amr))];
  }
}
