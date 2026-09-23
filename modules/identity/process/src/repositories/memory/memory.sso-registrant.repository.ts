import { normalizeIdentifierValue } from "@langwatch/identity-contract";

import type { SsoRegistrantReadRepository } from "../sso-registrant.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

const HELD_STATES = new Set(["VERIFIED", "PRIMARY"]);

/** The same two questions over the store's own user, identifier and account rows. */
export class MemorySsoRegistrantReadRepository implements SsoRegistrantReadRepository {
  static create(store: MemoryIdentityStore): MemorySsoRegistrantReadRepository {
    return new MemorySsoRegistrantReadRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async holdsAddress({ userId, email }: { userId: string; email: string }): Promise<boolean> {
    const address = email.trim().toLowerCase();
    if (!address) return false;

    const user = this.store.users.get(userId);
    if (user?.email?.trim().toLowerCase() === address) return true;

    const normalized = normalizeIdentifierValue(address);
    for (const identifier of this.store.identifiers.values()) {
      if (
        identifier.userId === userId &&
        identifier.value === normalized &&
        HELD_STATES.has(identifier.state)
      ) {
        return true;
      }
    }
    return false;
  }

  async findAccountHolderIds({
    connectionId,
    accountId,
  }: {
    connectionId: string;
    accountId: string;
  }): Promise<string[]> {
    if (!accountId) return [];

    const holders: string[] = [];
    for (const [userId, accounts] of this.store.accounts) {
      const bound = accounts.some(
        (account) => account.provider === connectionId && account.providerAccountId === accountId,
      );
      if (bound) holders.push(userId);
    }
    return holders;
  }
}
