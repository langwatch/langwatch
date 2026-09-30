import type { PrismaClient } from "~/generated/prisma/client";
import type {
  PriorSessionRepository,
  PriorSessionRow,
} from "../prior-session.service";

/**
 * The one row behind the signed-out screen's recognition (ADR-129 tiering).
 *
 * Keyed by the session token alone, because that is the only thing the caller
 * presented and therefore the only thing there is to look up. The row is
 * flattened on the way out: the service decides what may be SAID about a
 * session, and it can do that from an expiry and an address without also
 * learning the shape Prisma returns them in.
 */
export class PrismaPriorSessionRepository implements PriorSessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Answers `null` for a token with no row — revoked, or never issued. Both
   * are the same answer on purpose; see `PriorSessionService`'s docblock for
   * why the screen must not tell them apart.
   */
  async findByToken({
    token,
  }: {
    token: string;
  }): Promise<PriorSessionRow | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionToken: token },
      select: { expires: true, user: { select: { email: true } } },
    });
    if (!session) return null;

    return { expires: session.expires, email: session.user?.email ?? null };
  }
}
