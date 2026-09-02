import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  type AuthzAuditRow,
  AuthzAuditTrailStore,
} from "../../adapters/eventing.authz-audit.adapter";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type AuthzAuditDatabase = Pick<PrismaClient, "auditLog">;

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
      data: [{ ...row, metadata: row.metadata as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
  }
}
