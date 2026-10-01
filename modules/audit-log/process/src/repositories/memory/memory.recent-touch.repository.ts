import { Temporal } from "@langwatch/time";

import type {
  FindRecentTouchesInput,
  RecentTouch,
  RecentTouchRepository,
} from "../recent-touch.repository.ts";
import type { MemoryAuditLogStore } from "./memory.audit-log.store.ts";

export class MemoryRecentTouchRepository implements RecentTouchRepository {
  private constructor(private readonly store: MemoryAuditLogStore) {}

  static create({ store }: { store: MemoryAuditLogStore }): MemoryRecentTouchRepository {
    return new MemoryRecentTouchRepository(store);
  }

  async findRecentTouches(input: FindRecentTouchesInput): Promise<RecentTouch[]> {
    return this.store.rows
      .toReversed()
      .filter(
        (row) =>
          row.userId === input.userId &&
          row.projectId === input.projectId &&
          input.actionPrefixes.some((prefix) => row.action.startsWith(prefix)),
      )
      .toSorted((left, right) => Temporal.Instant.compare(right.createdAt, left.createdAt))
      .slice(0, input.limit)
      .map((row) => ({ action: row.action, args: row.args ?? null, createdAt: row.createdAt }));
  }
}
