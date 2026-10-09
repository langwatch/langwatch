import { isUnprovenAccount } from "../../rules/unproven-account.rules.ts";
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
        })
      );
    });
    if (!dryRun) {
      for (const userId of reopened) this.store.finalizedUsers.delete(userId);
    }
    return reopened.length;
  }
}
