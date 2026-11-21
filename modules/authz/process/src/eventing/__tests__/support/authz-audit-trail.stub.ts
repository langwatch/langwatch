import {
  type AuthzAuditRow,
  AuthzAuditTrailRepository,
} from "../../../repositories/authz-audit-trail.repository.ts";

/** An audit store that keeps the first row per id, as the Prisma insert's skipDuplicates does. */
export class KeyedAuditTrailStore extends AuthzAuditTrailRepository {
  readonly rows = new Map<string, AuthzAuditRow>();

  async insert(row: AuthzAuditRow): Promise<void> {
    if (!this.rows.has(row.id)) this.rows.set(row.id, row);
  }
}
