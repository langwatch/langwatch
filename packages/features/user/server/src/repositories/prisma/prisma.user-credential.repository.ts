import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  type UnlinkUserAccountOutcome,
  type UserCredentialAccount,
  UserCredentialRepository,
  type UserLinkedAccount,
} from "../user-credential.repository";

/**
 * The one model and the one transaction runner these five statements need.
 *
 * Typed at the seam — a `Pick` of the generated client rather than the `object`
 * the older user repository still takes — so a composition that passes the
 * wrong connection is a compile error rather than a runtime `in` test.
 */
export type UserCredentialDatabase = Pick<PrismaClient, "account" | "$transaction">;

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * The provider name Auth0-federated identities carry, and the prefix that
 * separates Auth0's OWN database identity from a social one it federates.
 */
const AUTH0_PROVIDER = "auth0";
const AUTH0_DATABASE_SUBJECT_PREFIX = "auth0|";

/**
 * The account rows behind the /settings/authentication screens.
 *
 * These five statements were written in the API process's own composition
 * (`apps/api/src/app/api-trpc-ports.composition.ts`), which is how a `select`
 * naming `password` came to live outside the package that owns the stored
 * credential format. The lint that governs Prisma reads governs IMPORTS rather
 * than call sites, so a composition already holding the client could select
 * that column with no rule attached to the read at all.
 *
 * They read the same rows, with the same predicates, from inside the feature
 * that owns them.
 */
export class PrismaUserCredentialRepository extends UserCredentialRepository {
  private constructor(private readonly database: UserCredentialDatabase) {
    super();
  }

  static create(database: UserCredentialDatabase): PrismaUserCredentialRepository {
    return new PrismaUserCredentialRepository(database);
  }

  async tryFindCredentialAccount({
    userId,
  }: {
    userId: string;
  }): Promise<UserCredentialAccount | null> {
    const row = await this.database.account.findFirst({
      where: { userId, provider: CREDENTIAL_PROVIDER },
      select: { id: true, password: true },
    });
    return row ? { id: row.id, passwordHash: row.password } : null;
  }

  async writePasswordHash({
    accountId,
    passwordHash,
  }: {
    accountId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.database.account.update({
      where: { id: accountId },
      data: { password: passwordHash },
    });
  }

  async tryFindAuth0DatabaseAccount({
    userId,
  }: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    return await this.database.account.findFirst({
      where: {
        userId,
        provider: AUTH0_PROVIDER,
        providerAccountId: { startsWith: AUTH0_DATABASE_SUBJECT_PREFIX },
      },
      select: { providerAccountId: true },
    });
  }

  async findLinkedAccounts({ userId }: { userId: string }): Promise<UserLinkedAccount[]> {
    return await this.database.account.findMany({
      where: { userId },
      select: { id: true, provider: true, providerAccountId: true },
    });
  }

  async unlinkAccount({
    userId,
    accountId,
  }: {
    userId: string;
    accountId: string;
  }): Promise<UnlinkUserAccountOutcome> {
    // Serializable isolation prevents the read of the account count from being
    // a stale snapshot if a concurrent unlink commits between this
    // transaction's count and its delete.
    return await this.database.$transaction(
      async (transaction) => {
        const accountCount = await transaction.account.count({ where: { userId } });
        if (accountCount <= 1) return "last_account" as const;
        const account = await transaction.account.findFirst({
          where: { id: accountId, userId },
        });
        if (!account) return "not_found" as const;
        await transaction.account.delete({ where: { id: accountId } });
        return "unlinked" as const;
      },
      { isolationLevel: "Serializable" },
    );
  }
}
