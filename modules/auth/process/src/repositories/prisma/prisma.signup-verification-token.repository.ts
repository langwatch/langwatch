import { PrismaRepository } from "@langwatch/prisma-client";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  SignUpVerificationTokenRepository,
  TokenClaim,
} from "../signup-verification.repository.ts";

/** A spent row's namespace: recognised by `findSpent`, never claimable. */
const SPENT_NAMESPACE = "identity-signup-spent:";

const UNCLAIMED: TokenClaim = { claimed: false };

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
   * Renaming the row into the spent namespace is the claim. The update is conditional on
   * the identifier it read, so of two racing openings only one wins.
   */
  async claim({
    token,
    now,
    keepSpentUntil,
  }: {
    token: string;
    now: Instant;
    keepSpentUntil: Instant;
  }): Promise<TokenClaim> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { token },
      select: { identifier: true, expires: true },
    });
    if (!row || Temporal.Instant.compare(fromDate(row.expires), now) <= 0) return UNCLAIMED;
    if (row.identifier.startsWith(SPENT_NAMESPACE)) return UNCLAIMED;

    const marked = await this.prisma.verificationToken.updateMany({
      where: { token, identifier: row.identifier },
      data: { identifier: `${SPENT_NAMESPACE}${row.identifier}`, expires: toDate(keepSpentUntil) },
    });

    return marked.count === 0 ? UNCLAIMED : { claimed: true, identifier: row.identifier };
  }

  async findSpent({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { token },
      select: { identifier: true, expires: true },
    });
    if (!row || Temporal.Instant.compare(fromDate(row.expires), now) <= 0) return null;
    if (!row.identifier.startsWith(SPENT_NAMESPACE)) return null;

    return { identifier: row.identifier.slice(SPENT_NAMESPACE.length) };
  }

  /** One conditional delete, so the identifier binding and the spend cannot race apart. */
  async claimExpected({
    token,
    identifier,
    now,
  }: {
    token: string;
    identifier: string;
    now: Instant;
  }): Promise<boolean> {
    const claimed = await this.prisma.verificationToken.deleteMany({
      where: { token, identifier, expires: { gt: toDate(now) } },
    });

    return claimed.count === 1;
  }

  async hasExpected({
    token,
    identifier,
    now,
  }: {
    token: string;
    identifier: string;
    now: Instant;
  }): Promise<boolean> {
    const live = await this.prisma.verificationToken.count({
      where: { token, identifier, expires: { gt: toDate(now) } },
    });

    return live === 1;
  }
}
