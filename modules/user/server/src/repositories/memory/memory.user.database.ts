/**
 * The rows the two user repositories share.
 *
 * One store rather than two, because they share the `Account` table: a
 * credential minted by `createCredentialUser` is the row `findCredentialAccount`
 * reads back, exactly as it is in Postgres.
 */
export type MemoryUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  image: string | null;
  pendingSsoSetup: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  deactivatedAt: Date | null;
  lastHomePath: string | null;
  tracesExplorerTourDismissedAt: Date | null;
  passkeyNudgeDismissedAt: Date | null;
};

export type MemoryUserAccountRow = {
  id: string;
  userId: string;
  type: string;
  provider: string;
  issuer: string;
  providerAccountId: string;
  password: string | null;
};

export type MemoryUserPasskeyRow = {
  id: string;
  userId: string;
};

export class MemoryUserDatabase {
  #users = new Map<string, MemoryUserRow>();
  #accounts = new Map<string, MemoryUserAccountRow>();
  #passkeys = new Map<string, MemoryUserPasskeyRow>();

  private constructor() {}

  static create(): MemoryUserDatabase {
    return new MemoryUserDatabase();
  }

  user(id: string): MemoryUserRow | undefined {
    return this.#users.get(id);
  }

  userByEmail(email: string): MemoryUserRow | undefined {
    return [...this.#users.values()].find((row) => row.email === email);
  }

  userByEmailInsensitive(email: string): MemoryUserRow | undefined {
    const wanted = email.toLowerCase();

    return [...this.#users.values()].find((row) => row.email?.toLowerCase() === wanted);
  }

  usersById(ids: readonly string[]): MemoryUserRow[] {
    return ids.flatMap((id) => {
      const row = this.#users.get(id);

      return row ? [row] : [];
    });
  }

  writeUser(row: MemoryUserRow): void {
    this.#users.set(row.id, row);
  }

  accountsOf(userId: string): MemoryUserAccountRow[] {
    return [...this.#accounts.values()].filter((row) => row.userId === userId);
  }

  account(id: string): MemoryUserAccountRow | undefined {
    return this.#accounts.get(id);
  }

  writeAccount(row: MemoryUserAccountRow): void {
    this.#accounts.set(row.id, row);
  }

  deleteAccount(id: string): void {
    this.#accounts.delete(id);
  }

  passkeyCount(userId: string): number {
    return [...this.#passkeys.values()].filter((row) => row.userId === userId).length;
  }

  writePasskey(row: MemoryUserPasskeyRow): void {
    this.#passkeys.set(row.id, row);
  }
}
