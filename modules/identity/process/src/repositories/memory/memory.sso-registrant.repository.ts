import { isLiveIdentifierState, normalizeIdentifierValue } from "@langwatch/identity-contract";

import type {
  SsoAccountKey,
  SsoRegistrantReadRepository,
  SsoResolutionAccount,
  SsoResolutionCandidate,
} from "../sso-registrant.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

const HELD_STATES = new Set(["VERIFIED", "PRIMARY"]);
const folded = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();

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

  async findUsersByEmail({ email }: { email: string }): Promise<SsoResolutionCandidate[]> {
    return [...this.store.users.values()]
      .filter((user) => user.email !== null && folded(user.email) === folded(email))
      .slice(0, 2)
      .map((user) => ({
        id: user.id,
        emailVerified: user.emailVerified,
        deactivated: this.store.deactivatedUsers.has(user.id),
      }));
  }

  async findBindingHolderIds({
    connectionId,
    accountKey,
  }: {
    connectionId: string;
    accountKey: SsoAccountKey;
  }): Promise<string[]> {
    return this.#accounts()
      .filter(
        (account) =>
          account.provider === connectionId &&
          account.issuer === accountKey.issuer &&
          account.providerAccountId === accountKey.accountId,
      )
      .map((account) => account.userId);
  }

  async findAccountsForUserOrSubject({
    userId,
    accountKey,
  }: {
    userId: string;
    accountKey: SsoAccountKey;
  }): Promise<SsoResolutionAccount[]> {
    return this.#accounts().filter(
      (account) =>
        account.userId === userId ||
        (account.issuer === accountKey.issuer &&
          account.providerAccountId === accountKey.accountId),
    );
  }

  async isAddressOrSubjectHeldByAnother({
    userId,
    email,
    accountKey,
  }: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean> {
    return [...this.store.identifiers.values()].some(
      (identifier) =>
        identifier.userId !== userId &&
        isLiveIdentifierState(identifier.state) &&
        (folded(identifier.value) === folded(email) ||
          (identifier.issuer === accountKey.issuer &&
            identifier.providerAccountId === accountKey.accountId)),
    );
  }

  /** The memory tier keeps credential presence only on the legacy sign-in rows. */
  async hasStoredCredential({ userId }: { userId: string }): Promise<boolean> {
    return [...this.store.legacySignInAccounts.values()].some(
      (held) => held.userId === userId && (held.methods.hasPassword || held.methods.hasPasskey),
    );
  }

  async hasProvingIdentifier({
    userId,
    email,
    accountKey,
  }: {
    userId: string;
    email: string;
    accountKey: SsoAccountKey;
  }): Promise<boolean> {
    return [...this.store.identifiers.values()].some((identifier) => {
      if (!isLiveIdentifierState(identifier.state)) return false;
      const pendingDirectoryAddress =
        identifier.userId === userId &&
        identifier.provider === "email" &&
        identifier.value !== null &&
        folded(identifier.value) === folded(email) &&
        identifier.state === "ATTACHED" &&
        identifier.verifiedAtMs === null &&
        identifier.accountId === null &&
        identifier.providerId === null &&
        identifier.issuer === null &&
        identifier.providerAccountId === null;
      if (pendingDirectoryAddress) return false;
      return (
        identifier.userId === userId ||
        (identifier.issuer === accountKey.issuer &&
          identifier.providerAccountId === accountKey.accountId) ||
        folded(identifier.value) === folded(email)
      );
    });
  }

  #accounts(): SsoResolutionAccount[] {
    return [...this.store.accounts].flatMap(([userId, rows]) =>
      rows.map((row) => ({
        userId,
        provider: row.provider,
        issuer: row.issuer,
        providerAccountId: row.providerAccountId,
      })),
    );
  }
}
