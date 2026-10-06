import type { MigrationMembershipRepository } from "../migration-membership.repository.ts";

/** Memberships are not ops' to hold, so this tier finds no user in any organization. */
export class MemoryMigrationMembershipRepository implements MigrationMembershipRepository {
  static create(): MemoryMigrationMembershipRepository {
    return new MemoryMigrationMembershipRepository();
  }

  private constructor() {}

  async isMemberOfAny(_input: {
    userId: string;
    organizationIds: readonly string[];
  }): Promise<boolean> {
    return false;
  }
}
