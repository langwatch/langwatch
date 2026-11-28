import { prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  SignUpVerificationTokenRepository,
  TokenClaim,
} from "../signup-verification.repository.ts";

/** A spent row's namespace: recognised by `findSpent`, never claimable. */
const SPENT_NAMESPACE = "identity-signup-spent:";

const UNCLAIMED: TokenClaim = { claimed: false };

type VerificationTokenDatabase = Pick<PrismaClient, "verificationToken" | "$executeRaw">;

/**
 * Sign-up's address-confirmation tokens, over the `VerificationToken` table.
 */
export class PrismaSignUpVerificationTokenRepository implements SignUpVerificationTokenRepository {
  static readonly tables = prismaTables("VerificationToken");

  static create({
    prisma,
  }: {
    prisma: VerificationTokenDatabase;
  }): PrismaSignUpVerificationTokenRepository {
    return new PrismaSignUpVerificationTokenRepository(prisma);
  }

  private constructor(private readonly prisma: VerificationTokenDatabase) {}

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
   * Renaming the row into the spent namespace is the claim. One statement re-checks the
   * live identifier and expiry at the write, so two concurrent openings cannot both win.
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
    const row = await this.prisma.verificationToken.findFirst({
      where: { token },
      orderBy: { expires: "desc" },
      select: { identifier: true, expires: true },
    });
    if (!row || Temporal.Instant.compare(fromDate(row.expires), now) <= 0) return UNCLAIMED;
    if (row.identifier.startsWith(SPENT_NAMESPACE)) return UNCLAIMED;

    const marked = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // The row is addressed by its token and identifier, both in the WHERE.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "VerificationToken"
         SET "identifier" = ${`${SPENT_NAMESPACE}${row.identifier}`},
             "expires" = ${toDate(keepSpentUntil)}
       WHERE "token" = ${token}
         AND "identifier" = ${row.identifier}
         AND "identifier" NOT LIKE ${`${SPENT_NAMESPACE}%`}
         AND "expires" > ${toDate(now)}
    `;

    return marked === 1 ? { claimed: true, identifier: row.identifier } : UNCLAIMED;
  }

  async findSpent({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: { token },
      orderBy: { expires: "desc" },
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
