import type {
  GdprOrganizationRow,
  GdprOrganizationWithMemberCount,
  GdprProjectRow,
  GdprUser,
  GdprUserDataEraseRepository,
} from "../user-data-erase.repository.ts";
import type { MemoryUserDatabase } from "./memory.user.database.ts";

/**
 * The erasure's memory twin over the user rows this tier holds. The memory tier keeps no
 * organizations, teams or projects of user's, so the person owns and shares none.
 */
export class MemoryGdprUserDataEraseRepository implements GdprUserDataEraseRepository {
  static create({ database }: { database: MemoryUserDatabase }): MemoryGdprUserDataEraseRepository {
    return new MemoryGdprUserDataEraseRepository(database);
  }

  private constructor(private readonly database: MemoryUserDatabase) {}

  async findUserByEmail(email: string): Promise<GdprUser | null> {
    const row = this.database.rows().find((user) => user.email === email);

    return row ? { id: row.id } : null;
  }

  async findUserById(id: string): Promise<GdprUser | null> {
    const [row] = this.database.usersById([id]);

    return row ? { id: row.id } : null;
  }

  async findSoleOwnedOrganizations(): Promise<GdprOrganizationRow[]> {
    return [];
  }

  async findSharedOrganizations(): Promise<GdprOrganizationWithMemberCount[]> {
    return [];
  }

  async findSoleOwnedTeams(): Promise<GdprOrganizationRow[]> {
    return [];
  }

  async findSharedTeams(): Promise<GdprOrganizationWithMemberCount[]> {
    return [];
  }

  async findProjectsUnderTeams(): Promise<GdprProjectRow[]> {
    return [];
  }

  async findSharedOrgsWhereUserIsSoleAdmin(): Promise<GdprOrganizationRow[]> {
    return [];
  }

  async countOtherAdmins(): Promise<number> {
    return 0;
  }

  async findTeamsUnderSoleOrgsWithOtherMembers(): Promise<GdprOrganizationRow[]> {
    return [];
  }

  async eraseUserAndOwnedResources(input: { userId: string }): Promise<void> {
    this.database.deleteUser(input.userId);
  }
}
