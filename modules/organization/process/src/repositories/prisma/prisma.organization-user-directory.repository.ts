import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Only what this repository touches, so composition names the slice it needs. */
export type OrganizationUserDirectoryDatabase = Pick<PrismaClient, "user">;

/**
 * The organization's own reads of the `User` table: an invited address, the
 * legacy verified-email column, and member display names — read narrowly
 * through this module's own repository, as every module does.
 */
export class PrismaOrganizationUserDirectoryRepository {
  static create(
    database: OrganizationUserDirectoryDatabase,
  ): PrismaOrganizationUserDirectoryRepository {
    return new PrismaOrganizationUserDirectoryRepository(database);
  }

  private constructor(private readonly database: OrganizationUserDirectoryDatabase) {}

  async findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null> {
    const user = await this.database.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /** The legacy verified-email column, for a user with no identity-ledger entry. */
  async findLegacyVerifiedEmail(userId: string): Promise<string | null> {
    const row = await this.database.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    return row?.emailVerified ? (row.email ?? null) : null;
  }

  /** Display names for a page of user ids the organization already vouches for. */
  async findUserNames(
    userIds: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    return this.database.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });
  }
}
