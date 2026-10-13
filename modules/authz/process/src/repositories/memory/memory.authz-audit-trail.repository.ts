import { Temporal } from "@langwatch/time";

import { type AuthzAuditRow, AuthzAuditTrailRepository } from "../authz-audit-trail.repository.ts";
import type { AuthzMemoryStore } from "./authz-memory.store.ts";

/** The audit table a process without a database keeps: the first row under an id stands. */
export class MemoryAuthzAuditTrailRepository extends AuthzAuditTrailRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzAuditTrailRepository {
    return new MemoryAuthzAuditTrailRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async insert(row: AuthzAuditRow): Promise<void> {
    if (this.memory.auditLogs.some((stored) => stored.id === row.id)) return;
    this.memory.auditLogs.push({
      ...row,
      createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.epochMilliseconds),
      metadata: structuredClone(row.metadata),
    });
  }
}
