import type { IdentityStorageAdapterInput } from "@langwatch/identity-contract";
import { memoryAdapter } from "better-auth/adapters/memory";

import { BetterAuthStorageRepository } from "../better-auth-storage.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/** Better Auth's own memory adapter over auth's memory database, so the memory
 *  tier signs in against the rows its twins read. It has no transactions, so
 *  the "transaction" runs the work over the same engine. */
export class MemoryBetterAuthStorageRepository extends BetterAuthStorageRepository {
  static create({ memory }: { memory: MemoryAuthDatabase }): MemoryBetterAuthStorageRepository {
    return new MemoryBetterAuthStorageRepository(memory);
  }

  private constructor(private readonly memory: MemoryAuthDatabase) {
    super();
  }

  engines(): IdentityStorageAdapterInput {
    const legacyEngine = memoryAdapter(this.memory.db);
    return { legacyEngine, postgresTransaction: (work) => work(legacyEngine) };
  }
}
