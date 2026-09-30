import { AuthzSessionVersionRepository } from "../authz-session-version.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The session versions a process without Redis keeps, for as long as it runs. */
export class MemoryAuthzSessionVersionRepository extends AuthzSessionVersionRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzSessionVersionRepository {
    return new MemoryAuthzSessionVersionRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async getVersion({ userId }: { userId: string }): Promise<number> {
    return this.memory.sessionVersions.get(userId) ?? 0;
  }

  async bump({ userIds }: { userIds: readonly string[] }): Promise<void> {
    for (const userId of userIds) {
      this.memory.sessionVersions.set(userId, (this.memory.sessionVersions.get(userId) ?? 0) + 1);
    }
  }
}
