import type { Instant } from "@langwatch/time";

/**
 * The rows the two user repositories share — one store rather than two,
 * since they share the `Account` table: a credential `createCredentialUser`
 * mints is the row `findCredentialAccount` reads back, exactly as in Postgres.
 */
export type MemoryUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  image: string | null;
  pendingSsoSetup: boolean;
  createdAt: Instant;
  updatedAt: Instant;
  lastLoginAt: Instant | null;
  deactivatedAt: Instant | null;
  lastHomePath: string | null;
  tracesExplorerTourDismissedAt: Instant | null;
  langyCodeAccessPreference?: string | null;
  passkeyNudgeDismissedAt: Instant | null;
  /** Two-step verification confirmed on the account, as the plugin records it. */
  twoFactorEnabled: boolean;
  joinOfferDismissedDomains: readonly string[];
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

  /** Every stored user, for the install-wide usage report. */
  rows(): MemoryUserRow[] {
    return [...this.#users.values()];
  }

  usersWithEmail(email: string): MemoryUserRow[] {
    return [...this.#users.values()].filter((row) => row.email === email);
  }

  usersWithEmailInsensitive(email: string): MemoryUserRow[] {
    const wanted = email.toLowerCase();

    return [...this.#users.values()].filter((row) => row.email?.toLowerCase() === wanted);
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

  accountsById(ids: readonly string[]): MemoryUserAccountRow[] {
    return ids.flatMap((id) => {
      const row = this.#accounts.get(id);

      return row ? [row] : [];
    });
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
