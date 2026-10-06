import type { IdentityAccountSecrets } from "../../rules/identity-storage.rules.ts";
import type {
  AccountSecretPair,
  IdentitySecretCarryRepository,
} from "../../services/identity-secret-carry.service.ts";

/** Each account and the credential beside it, in memory, keyed by account. */
export class MemoryIdentitySecretCarryRepository implements IdentitySecretCarryRepository {
  static create(): MemoryIdentitySecretCarryRepository {
    return new MemoryIdentitySecretCarryRepository();
  }

  private readonly pairs = new Map<string, AccountSecretPair>();

  private constructor() {}

  async findAccountSecretPairs(args: { userId: string }): Promise<AccountSecretPair[]> {
    return [...this.pairs.values()].filter((pair) => pair.userId === args.userId);
  }

  async findDriftedUserIdsAfter(args: { cursor: string | null; limit: number }): Promise<string[]> {
    const drifted = new Set<string>();
    for (const pair of this.pairs.values()) {
      const behind =
        pair.credentialUpdatedAtMs === null || pair.accountUpdatedAtMs > pair.credentialUpdatedAtMs;
      if (behind && (args.cursor === null || pair.userId > args.cursor)) drifted.add(pair.userId);
    }
    return [...drifted].toSorted().slice(0, args.limit);
  }

  async insertCredentialIfMissing(args: {
    accountId: string;
    userId: string;
    providerId: string;
    secrets: IdentityAccountSecrets;
    createdAtMs: number;
    updatedAtMs: number;
  }): Promise<boolean> {
    const existing = this.pairs.get(args.accountId);
    if (existing?.credentialUpdatedAtMs != null) return false;
    this.pairs.set(args.accountId, {
      accountId: args.accountId,
      userId: args.userId,
      providerId: args.providerId,
      accountCreatedAtMs: existing?.accountCreatedAtMs ?? args.createdAtMs,
      accountUpdatedAtMs: existing?.accountUpdatedAtMs ?? args.updatedAtMs,
      credentialUpdatedAtMs: args.updatedAtMs,
      secrets: args.secrets,
    });
    return true;
  }

  async overwriteCredential(args: {
    accountId: string;
    secrets: IdentityAccountSecrets;
    updatedAtMs: number;
  }): Promise<void> {
    const existing = this.pairs.get(args.accountId);
    if (!existing) return;
    this.pairs.set(args.accountId, {
      ...existing,
      secrets: args.secrets,
      credentialUpdatedAtMs: args.updatedAtMs,
    });
  }
}
