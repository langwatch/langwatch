import { OrganizationUserDirectoryRepository } from "../organization-user-directory.repository.ts";
import type { MemoryOrganizationDatabase } from "./memory.organization.database.ts";

/** The organization's reads of the people table, over the memory users. */
export class MemoryOrganizationUserDirectoryRepository extends OrganizationUserDirectoryRepository {
  static create(options: {
    memory: MemoryOrganizationDatabase;
  }): MemoryOrganizationUserDirectoryRepository {
    return new MemoryOrganizationUserDirectoryRepository(options.memory);
  }

  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  async findUserIdByEmail(input: Readonly<{ email: string }>): Promise<string | null> {
    return [...this.memory.users.values()].find((user) => user.email === input.email)?.id ?? null;
  }

  async findLegacyVerifiedEmail(userId: string): Promise<string | null> {
    const user = this.memory.users.get(userId);
    return user?.emailVerified ? (user.email ?? null) : null;
  }

  async findUserNames(
    userIds: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    return userIds.flatMap((id) => {
      const user = this.memory.users.get(id);
      return user ? [{ id: user.id, name: user.name }] : [];
    });
  }
}
