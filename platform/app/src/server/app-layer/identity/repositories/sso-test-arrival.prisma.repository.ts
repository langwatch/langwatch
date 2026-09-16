import type { PrismaClient } from "~/generated/prisma/client";
import type { SsoTestArrivalAccountsPort } from "../sso-test-arrival.service";

/**
 * The providers one person holds an account through.
 *
 * Read for the whole user rather than filtered to connection ids in SQL: a
 * connection id is recognised by its prefix
 * (`looksLikeSsoConnectionId`), and encoding that shape as a `startsWith`
 * here would put the same rule in two places with only one of them tested.
 * The row count is a person's sign-in methods — single digits.
 *
 * Newest first, so somebody who has tested more than one connection is
 * answered about the one they just came through.
 */
export class PrismaSsoTestArrivalAccountsRepository
  implements SsoTestArrivalAccountsPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAccountProvidersForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly string[]> {
    const accounts = await this.prisma.account.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { createdAt: "desc" },
    });
    return accounts.map((account) => account.provider);
  }
}
