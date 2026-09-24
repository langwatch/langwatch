import { PrismaRepository } from "@langwatch/prisma-client";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  AuthSessionRepository,
  BrowserSessionRecord,
  StoredBrowserSession,
} from "../auth-session.repository.ts";

const sessionSelect = {
  id: true,
  userId: true,
  sessionToken: true,
  impersonating: true,
  createdAt: true,
  lastSeenAt: true,
  updatedAt: true,
} as const;

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

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    const row = await this.prisma.session.findUnique({ where: { id }, select: sessionSelect });
    if (!row) return null;

    return {
      ...row,
      createdAt: fromDate(row.createdAt),
      lastSeenAt: row.lastSeenAt ? fromDate(row.lastSeenAt) : null,
      updatedAt: fromDate(row.updatedAt),
    };
  }

  async findStoredForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly StoredBrowserSession[]> {
    const rows = await this.prisma.session.findMany({ where: { userId }, select: sessionSelect });

    return rows.map((row) => ({
      ...row,
      createdAt: fromDate(row.createdAt),
      lastSeenAt: row.lastSeenAt ? fromDate(row.lastSeenAt) : null,
      updatedAt: fromDate(row.updatedAt),
    }));
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
}
