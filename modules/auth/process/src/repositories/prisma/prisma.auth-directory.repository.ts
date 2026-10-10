import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserNotFoundError } from "@langwatch/user-contract";

import type { AuthDirectoryRepository } from "../auth-directory.repository.ts";

type Database = Pick<PrismaClient, "user">;

export class PrismaAuthDirectoryRepository implements AuthDirectoryRepository {
  private constructor(private readonly database: Database) {}

  static create(database: Database): PrismaAuthDirectoryRepository {
    return new PrismaAuthDirectoryRepository(database);
  }

  async getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }> {
    const person = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (person === null) throw new UserNotFoundError(userId);
    return person;
  }
}
