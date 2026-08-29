import { describe, expect, it } from "vitest";
import type { AuthzAuditRow } from "../../../adapters/eventing.authz-audit.adapter";
import {
  type AuthzAuditDatabase,
  PrismaAuthzAuditRepository,
} from "../prisma.authz-audit.repository";

const ROW: AuthzAuditRow = {
  id: "authz-evt-event_1",
  createdAt: new Date("2026-08-23T12:00:00.000Z"),
  userId: "user_1",
  organizationId: "org_1",
  action: "authz.grants.attach",
  metadata: { grantId: "grant_1" },
};

class InMemoryAuditTable {
  readonly rows = new Map<string, AuthzAuditRow>();
  readonly writes: Array<{
    data: AuthzAuditRow[];
    skipDuplicates: boolean;
  }> = [];

  async createMany(args: {
    data: AuthzAuditRow[];
    skipDuplicates: boolean;
  }): Promise<{ count: number }> {
    this.writes.push(args);
    let count = 0;
    for (const row of args.data) {
      if (this.rows.has(row.id) && args.skipDuplicates) continue;
      this.rows.set(row.id, row);
      count += 1;
    }
    return { count };
  }
}

describe("PrismaAuthzAuditRepository", () => {
  /** @scenario "Audit subscriber redelivery inserts one audit record" */
  it("uses insert-only duplicate skipping for subscriber redelivery", async () => {
    const auditLog = new InMemoryAuditTable();
    const repository = PrismaAuthzAuditRepository.create({
      auditLog,
    } satisfies AuthzAuditDatabase);

    await repository.insert(ROW);
    await repository.insert({
      ...ROW,
      action: "authz.grants.revoke",
    });

    expect(auditLog.writes).toEqual([
      { data: [ROW], skipDuplicates: true },
      {
        data: [{ ...ROW, action: "authz.grants.revoke" }],
        skipDuplicates: true,
      },
    ]);
    expect([...auditLog.rows.values()]).toEqual([ROW]);
  });
});
