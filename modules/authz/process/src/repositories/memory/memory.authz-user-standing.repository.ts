import type { Instant } from "@langwatch/time";

import { AuthzUserStandingRepository } from "../authz-user-standing.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The standing table a process without a database keeps, with the same ordering rule. */
export class MemoryAuthzUserStandingRepository extends AuthzUserStandingRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzUserStandingRepository {
    return new MemoryAuthzUserStandingRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async recordDeactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    this.recordActivation({ userId, at, deactivated: true });
  }

  async recordReactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    this.recordActivation({ userId, at, deactivated: false });
  }

  async recordErased({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    const row = this.memory.userStandings.get(userId);
    if (row) {
      row.erased = true;
      return;
    }
    this.memory.userStandings.set(userId, {
      deactivated: false,
      erased: true,
      changedAtMs: at.epochMilliseconds,
    });
  }

  async findInactiveUserIds({ userIds }: { userIds: readonly string[] }): Promise<string[]> {
    return [...new Set(userIds)].filter((userId) => this.memory.isInactiveUser(userId));
  }

  private recordActivation({
    userId,
    at,
    deactivated,
  }: {
    userId: string;
    at: Instant;
    deactivated: boolean;
  }): void {
    const row = this.memory.userStandings.get(userId);
    const ms = at.epochMilliseconds;
    // A tie goes to the deactivation, as the Prisma table orders it.
    if (row && (row.changedAtMs > ms || (row.changedAtMs === ms && !deactivated))) return;
    this.memory.userStandings.set(userId, {
      deactivated,
      erased: row?.erased ?? false,
      changedAtMs: ms,
    });
  }
}
