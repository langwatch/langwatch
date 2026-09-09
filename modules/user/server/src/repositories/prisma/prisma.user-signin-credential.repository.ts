import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserLinkedAccount,
} from "@langwatch/user-contract";
import type {
  UserCredentialAccount,
  UserCredentialRepository,
} from "../user-signin-credential.repository.ts";

/** The one model and the one transaction runner these five statements need. */
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
 * They read the same rows, with the same predicates, from inside the feature
 * that owns them — a `select` naming `password` used to live in the API
 * process's own composition, outside the package that owns the stored format.
 */
export class PrismaUserCredentialRepository
  extends PrismaRepository.transactionalFor("Account")
  implements UserCredentialRepository
{
  static readonly create = this.factory((prisma) => new PrismaUserCredentialRepository(prisma));

  readonly #database: UserCredentialDatabase;

  private constructor(prisma: UserCredentialDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async findCredentialAccount(input: { userId: string }): Promise<UserCredentialAccount | null> {
    const row = await this.prisma.account.findFirst({
      where: { userId: input.userId, provider: CREDENTIAL_PROVIDER },
      select: { id: true, password: true },
    });

    return row ? { id: row.id, passwordHash: row.password } : null;
  }

  async writePasswordHash(input: { accountId: string; passwordHash: string }): Promise<void> {
    await this.prisma.account.update({
      where: { id: input.accountId },
      data: { password: input.passwordHash },
    });
  }

  async findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    return await this.prisma.account.findFirst({
      where: {
        userId: input.userId,
        provider: AUTH0_PROVIDER,
        providerAccountId: { startsWith: AUTH0_DATABASE_SUBJECT_PREFIX },
      },
      select: { providerAccountId: true },
    });
  }

  async findLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]> {
    return await this.prisma.account.findMany({
      where: { userId: input.userId },
      select: { id: true, provider: true, providerAccountId: true },
    });
  }

  async unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome> {
    // Serializable isolation prevents the read of the account count from being
    // a stale snapshot if a concurrent unlink commits between this
    // transaction's count and its delete.
    return await this.#database.$transaction(
      async (transaction) => {
        const accountCount = await transaction.account.count({ where: { userId: input.userId } });
        if (accountCount <= 1) return "last_account" as const;

        const account = await transaction.account.findFirst({
          where: { id: input.accountId, userId: input.userId },
        });
        if (!account) return "not_found" as const;

        await transaction.account.delete({ where: { id: input.accountId } });

        return "unlinked" as const;
      },
      { isolationLevel: "Serializable" },
    );
  }
}
