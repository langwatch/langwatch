import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";
import type { SignUpVerificationTokenRepository } from "../signup-verification.repository.ts";

/**
 * Sign-up's address-confirmation tokens, over the `VerificationToken` table.
 */
export class PrismaSignUpVerificationTokenRepository
  extends PrismaRepository.for("VerificationToken")
  implements SignUpVerificationTokenRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaSignUpVerificationTokenRepository(prisma),
  );

  async issue({
    identifier,
    token,
    expires,
  }: {
    identifier: string;
    token: string;
    expires: Instant;
  }): Promise<void> {
    await this.prisma.verificationToken.create({
      data: { identifier, token, expires: toDate(expires) },
    });
  }

  /**
   * Deleting is the claim. A token that survived the delete never existed or was already
   * spent, and one that is deleted but out of date is refused all the same - the row goes
   * either way, so a spent link cannot be replayed even by the racer that lost.
   */
  async findAndClaim({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const claimed = await this.prisma.verificationToken
      .delete({ where: { token }, select: { identifier: true, expires: true } })
      .catch(() => null);

    if (!claimed) return null;
    const expired = Temporal.Instant.compare(fromDate(claimed.expires), now) <= 0;
    if (expired) return null;

    return { identifier: claimed.identifier };
  }
}
