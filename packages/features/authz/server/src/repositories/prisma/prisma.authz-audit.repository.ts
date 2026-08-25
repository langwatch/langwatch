import {
  type AuthzAuditRow,
  AuthzAuditTrailStore,
} from "../../adapters/eventing.authz-audit.adapter";

type AuthzAuditDelegate = {
  createMany(args: { data: AuthzAuditRow[]; skipDuplicates: boolean }): Promise<unknown>;
};

/** Structural database capability for the insert-only AuthZ audit trail. */
export type AuthzAuditDatabase = Readonly<{
  auditLog: AuthzAuditDelegate;
}>;

/**
 * Idempotent Postgres implementation keyed by the event-derived audit row ID.
 * A redelivered subscriber action is a successful no-op; it never updates the
 * immutable row produced by the first delivery.
 */
export class PrismaAuthzAuditRepository extends AuthzAuditTrailStore {
  static create(database: AuthzAuditDatabase): PrismaAuthzAuditRepository {
    return new PrismaAuthzAuditRepository(database.auditLog);
  }

  private constructor(private readonly auditLog: AuthzAuditDelegate) {
    super();
  }

  async insert(row: AuthzAuditRow): Promise<void> {
    await this.auditLog.createMany({ data: [row], skipDuplicates: true });
  }
}
