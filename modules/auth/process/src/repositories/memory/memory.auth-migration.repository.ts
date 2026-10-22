import { AuthMigrationRepository } from "../auth-migration.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/** The token columns as the channel maps Better Auth's names onto `Account`. */
const TOKEN_COLUMNS = ["access_token", "refresh_token", "id_token"] as const;

/** The migration twin over the `Account` rows Better Auth's memory adapter writes. */
export class MemoryAuthMigrationRepository extends AuthMigrationRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryAuthMigrationRepository {
    return new MemoryAuthMigrationRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  async discardProviderTokens({ dryRun }: { dryRun: boolean }): Promise<number> {
    const holding = this.memory.db.Account.filter((row) =>
      TOKEN_COLUMNS.some((column) => row[column] !== null && row[column] !== undefined),
    );
    if (!dryRun) {
      for (const row of holding) for (const column of TOKEN_COLUMNS) row[column] = null;
    }
    return holding.length;
  }
}
