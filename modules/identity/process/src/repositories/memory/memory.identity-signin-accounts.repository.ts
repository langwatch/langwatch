import type {
  IdentitySignInAccountsRepository,
  LegacySignInAccount,
} from "../identity-signin-accounts.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/**
 * The legacy branch in memory. Seeded rather than derived: the legacy tables
 * live outside this module's own store, so a twin that guessed at them would
 * be asserting a shape it does not own.
 */
export class MemoryIdentitySignInAccountsRepository implements IdentitySignInAccountsRepository {
  static create(store: MemoryIdentityStore): MemoryIdentitySignInAccountsRepository {
    return new MemoryIdentitySignInAccountsRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async findLegacySignInAccounts({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<LegacySignInAccount[]> {
    const held = this.store.legacySignInAccounts.get(normalizedValue.toLowerCase());

    return held ? [held] : [];
  }
}
