import { UserNotFoundError } from "@langwatch/user-contract";

import type { AuthDirectoryRepository } from "../auth-directory.repository.ts";
import type { MemoryAuthDatabase, MemoryUserRow } from "./memory.auth.database.ts";

/** The memory twin of the person a device grant names. */
export class MemoryAuthDirectoryRepository implements AuthDirectoryRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthDirectoryRepository {
    return new MemoryAuthDirectoryRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {}

  async getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }> {
    const person = (this.memory.db.User as MemoryUserRow[]).find((row) => row.id === userId);
    if (person === undefined) throw new UserNotFoundError(userId);
    return { id: person.id, email: person.email ?? null, name: person.name ?? null };
  }
}
