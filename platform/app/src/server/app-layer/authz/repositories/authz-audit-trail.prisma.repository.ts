import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type {
  AuthzAuditRow,
  AuthzAuditTrailStore,
} from "~/server/event-sourcing/pipelines/authz-grants/subscribers/authzAuditTrail.subscriber";

/**
 * The grants ledger's audit sink (ADR-092 decision 17). Insert-only, into
 * the existing `AuditLog` table the audit UI already reads — the table, the
 * page and the retention are untouched by the ledger.
 *
 * `createMany({ skipDuplicates: true })` for a single row rather than
 * `create`: it is the ON CONFLICT DO NOTHING the deterministic row id needs,
 * without a read-then-write race or a caught unique-violation. There is no
 * update path at all — a re-delivered event describes the same moment, so
 * the second write must be a no-op, not an overwrite.
 */
export class PrismaAuthzAuditTrailRepository implements AuthzAuditTrailStore {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: AuthzAuditRow): Promise<void> {
    await this.prisma.auditLog.createMany({
      data: [
        {
          id: row.id,
          createdAt: row.createdAt,
          userId: row.userId,
          organizationId: row.organizationId,
          action: row.action,
          metadata: row.metadata as Prisma.InputJsonObject,
        },
      ],
      skipDuplicates: true,
    });
  }
}
