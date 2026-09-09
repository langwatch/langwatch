import type {
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserLinkedAccount,
} from "@langwatch/user-contract";
import type {
  UserCredentialAccount,
  UserCredentialRepository,
} from "../user-signin-credential.repository.ts";
import { MemoryUserDatabase } from "./memory.user.database.ts";

/** better-auth's own provider name for an email-and-password sign-in method. */
const CREDENTIAL_PROVIDER = "credential";

/**
 * The provider name Auth0-federated identities carry, and the prefix that
 * separates Auth0's OWN database identity from a social one it federates.
 */
const AUTH0_PROVIDER = "auth0";
const AUTH0_DATABASE_SUBJECT_PREFIX = "auth0|";

/**
 * The Prisma credential repository's observable behaviour over the shared
 * account rows: the same hash handed back to the one caller that compares it,
 * the same refusal to unlink a person's last sign-in method.
 */
export class MemoryUserCredentialRepository implements UserCredentialRepository {
  #database: MemoryUserDatabase;

  private constructor(database: MemoryUserDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ database: MemoryUserDatabase }>,
  ): MemoryUserCredentialRepository {
    return new MemoryUserCredentialRepository(input.database);
  }

  async findCredentialAccount(input: { userId: string }): Promise<UserCredentialAccount | null> {
    const account = this.#database
      .accountsOf(input.userId)
      .find((row) => row.provider === CREDENTIAL_PROVIDER);

    return account ? { id: account.id, passwordHash: account.password } : null;
  }

  async writePasswordHash(input: { accountId: string; passwordHash: string }): Promise<void> {
    const account = this.#database.account(input.accountId);
    if (!account) return;

    this.#database.writeAccount({ ...account, password: input.passwordHash });
  }

  async findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    const account = this.#database
      .accountsOf(input.userId)
      .find(
        (row) =>
          row.provider === AUTH0_PROVIDER &&
          row.providerAccountId.startsWith(AUTH0_DATABASE_SUBJECT_PREFIX),
      );

    return account ? { providerAccountId: account.providerAccountId } : null;
  }

  async findLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]> {
    return this.#database.accountsOf(input.userId).map((row) => ({
      id: row.id,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
    }));
  }

  async unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome> {
    const accounts = this.#database.accountsOf(input.userId);
    if (accounts.length <= 1) return "last_account";

    const account = accounts.find((row) => row.id === input.accountId);
    if (!account) return "not_found";

    this.#database.deleteAccount(account.id);

    return "unlinked";
  }
}
