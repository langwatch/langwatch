import type { Prisma } from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import { type AuthzAuditRow, AuthzAuditTrailRepository } from "../authz-audit-trail.repository.ts";

// Narrow structural type: only createMany touched; avoids burdening test doubles.
export type AuthzAuditDatabase = {
  auditLog: {
    createMany(args: { data: AuthzAuditInsert[]; skipDuplicates: boolean }): Promise<unknown>;
  };
};

/**
 * The audit fact as written: `AuthzAuditRow`, except `metadata` arrives as
 * `Record<string, unknown>` for a `Json` column - narrow enough for the
 * seam above to implement without the generated delegate.
 */
export type AuthzAuditInsert = Omit<AuthzAuditRow, "createdAt" | "metadata"> & {
  createdAt: Date;
  metadata: Prisma.InputJsonValue;
};

/**
 * Idempotent Postgres implementation keyed by the event-derived audit row ID.
 * A redelivered subscriber action is a successful no-op; it never updates the
 * immutable row produced by the first delivery.
 */
export class PrismaAuthzAuditRepository extends AuthzAuditTrailRepository {
  static create(database: AuthzAuditDatabase): PrismaAuthzAuditRepository {
    return new PrismaAuthzAuditRepository(database.auditLog);
  }

  private constructor(private readonly auditLog: AuthzAuditDatabase["auditLog"]) {
    super();
  }

  async insert(row: AuthzAuditRow): Promise<void> {
    await this.auditLog.createMany({
      // The audit mapper builds `metadata` by copying named scalar fields off
      // the event, so it is a plain JSON object by construction and the column
      // it lands in is `Json`.
      data: [
        {
          ...row,
          createdAt: toDate(row.createdAt),
          metadata: row.metadata as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  }
}
