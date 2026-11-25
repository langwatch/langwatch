import {
  carriesPreProofSignInMethod,
  isUnprovenAccount,
} from "../../rules/unproven-account.rules.ts";
import { IdentityMigrationRepository } from "../identity-migration.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** The migration twin: the finalized-user set the latch twin keeps, against the user rows. */
export class MemoryIdentityMigrationRepository extends IdentityMigrationRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityMigrationRepository {
    return new MemoryIdentityMigrationRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async reopenUnprovenAccounts({ dryRun }: { dryRun: boolean }): Promise<number> {
    const reopened = [...this.store.finalizedUsers].filter((userId) => {
      const row = this.store.findUserRow({ userId });
      return (
        row !== null &&
        row.email !== null &&
        isUnprovenAccount({
          emailVerified: row.emailVerified,
          lastLoginAtMs: row.lastLoginAtMs ?? null,
        }) &&
        carriesPreProofSignInMethod({
          accounts: this.store.accounts.get(userId)?.length ?? 0,
          passkeys: this.store.passkeyCounts.get(userId) ?? 0,
          passkeySignupPending: row.passkeySignupPending ?? false,
        })
      );
    });
    if (!dryRun) {
      for (const userId of reopened) this.store.finalizedUsers.delete(userId);
    }
    return reopened.length;
  }

  /** The twin keeps one finalized set the latch reads, so there is no older table to copy. */
  async carryOverSignInSwitch(_args: { dryRun: boolean }): Promise<number> {
    return 0;
  }

  /** The twin's accounts keep no credential columns, so there is never a token to clear. */
  async discardProviderTokens(_args: { dryRun: boolean }): Promise<number> {
    return 0;
  }
}
