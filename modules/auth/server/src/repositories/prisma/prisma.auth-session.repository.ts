import { PrismaRepository } from "@langwatch/prisma-client";
import type {
  AuthSessionRepository,
  StoredBrowserSession,
} from "../auth-session.repository.ts";

const sessionSelect = {
  id: true,
  userId: true,
  sessionToken: true,
  impersonating: true,
} as const;

/**
 * The `Session` table, which auth owns outright: every row here is a browser
 * session, and nothing else in the product writes one.
 *
 * Deletes go through `deleteMany` rather than `delete` on purpose. A revocation
 * is idempotent - two tabs signing out race - and `delete` raises on a row that
 * has already gone, which would turn the second sign-out into an error.
 */
export class PrismaAuthSessionRepository
  extends PrismaRepository.for("Session")
  implements AuthSessionRepository
{
  static readonly create = this.factory((prisma) => new PrismaAuthSessionRepository(prisma));

  async findById({ id }: { id: string }): Promise<StoredBrowserSession | null> {
    return this.prisma.session.findUnique({ where: { id }, select: sessionSelect });
  }

  async listTokensForUser({ userId }: { userId: string }): Promise<string[]> {
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
