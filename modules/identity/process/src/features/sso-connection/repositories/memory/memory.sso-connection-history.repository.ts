import type { MemoryIdentityStore } from "../../../../repositories/memory/memory.identity.store.ts";
import {
  SsoConnectionHistoryRepository,
  type SsoConnectionHistoryEntry,
} from "../sso-connection-history.repository.ts";

/** The connection log's twin: entries the store holds per connection, newest first. */
export class MemorySsoConnectionHistoryRepository extends SsoConnectionHistoryRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionHistoryRepository {
    return new MemorySsoConnectionHistoryRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async findHistory({
    organizationId,
    connectionId,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly SsoConnectionHistoryEntry[]> {
    const entries = this.store.ssoConnectionHistory.get(`${organizationId}:${connectionId}`) ?? [];
    return entries.slice(0, limit);
  }
}
