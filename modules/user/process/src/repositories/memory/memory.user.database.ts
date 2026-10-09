import type { InMemoryProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { Instant } from "@langwatch/time";
import type { UserNotificationChoice } from "@langwatch/user-contract";

import { type UserFactIntent, userFactsAppend } from "../../rules/user-lifecycle-outbox.rules.ts";

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
  /** Topic to choice; a topic that is absent was never answered. */
  notificationPreferences: Readonly<Record<string, UserNotificationChoice>>;
};

type MemoryUserAccountRow = {
  id: string;
  userId: string;
  type: string;
  provider: string;
  issuer: string;
  providerAccountId: string;
  password: string | null;
};

type MemoryUserPasskeyRow = {
  id: string;
  userId: string;
};

export class MemoryUserDatabase {
  #users = new Map<string, MemoryUserRow>();
  #accounts = new Map<string, MemoryUserAccountRow>();
  #passkeys = new Map<string, MemoryUserPasskeyRow>();

  private constructor(private readonly processStore: InMemoryProcessStore) {}

  static create({
    processStore,
  }: Readonly<{ processStore: InMemoryProcessStore }>): MemoryUserDatabase {
    return new MemoryUserDatabase(processStore);
  }

  /** Every stored user, for the install-wide usage report. */
  rows(): MemoryUserRow[] {
    return [...this.#users.values()];
  }

  usersWithEmail(email: string): MemoryUserRow[] {
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

  /** User's facts into the shared process store's outbox, as the Prisma twin appends them. */
  async appendFacts({
    userId,
    intents,
  }: Readonly<{ userId: string; intents: readonly UserFactIntent[] }>): Promise<void> {
    const now = nowInstant().epochMilliseconds;
    await this.processStore.appendIntents(userFactsAppend({ userId, intents, now }));
  }

  /** Drops the user with every account and passkey it holds, as the erasure does. */
  deleteUser(id: string): void {
    this.#users.delete(id);
    for (const account of this.accountsOf(id)) this.#accounts.delete(account.id);
    this.deletePasskeysOf(id);
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

  deletePasskeysOf(userId: string): void {
    for (const [passkeyId, passkey] of this.#passkeys) {
      if (passkey.userId === userId) this.#passkeys.delete(passkeyId);
    }
  }
}
