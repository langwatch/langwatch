import { memoryAdapter } from "better-auth/adapters/memory";

import { BetterAuthStorageRepository } from "../better-auth-storage.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/** Better Auth's own memory adapter over auth's memory database, so the memory
 *  tier signs in against the rows its twins read. */
export class MemoryBetterAuthStorageRepository extends BetterAuthStorageRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryBetterAuthStorageRepository {
    return new MemoryBetterAuthStorageRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  adapter(): unknown {
    return memoryAdapter(this.memory.db);
  }
}
