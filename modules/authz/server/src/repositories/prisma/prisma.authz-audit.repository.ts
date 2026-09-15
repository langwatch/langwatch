import { Prisma } from "@langwatch/prisma-client/generated";
import {
  type AuthzAuditRow,
  AuthzAuditTrailStore,
} from "../authz-audit-trail.repository.ts";
import { toDate } from "@langwatch/time";

// Narrow structural type: only createMany touched; avoids burdening test doubles.
export type AuthzAuditDatabase = {
  auditLog: {
    createMany(args: { data: AuthzAuditInsert[]; skipDuplicates: boolean }): Promise<unknown>;
  };
};

/**
 * The audit fact as it is written: `AuthzAuditRow`, except that `metadata`
 * arrives as `Record<string, unknown>` and the column it lands in is `Json`.
 * Stating the written row here is what lets the seam above be narrow enough
 * to implement without the generated delegate.
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
export class PrismaAuthzAuditRepository extends AuthzAuditTrailStore {
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
