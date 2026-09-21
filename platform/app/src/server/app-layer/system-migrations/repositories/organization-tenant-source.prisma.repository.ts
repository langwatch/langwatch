import {
  TERMINAL_TENANT_STATUSES,
  type TenantSource,
} from "@langwatch/system-migrations";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Tenants for the migration runner are organizations, walked in id order so
 * a pass is stable however often it restarts.
 */
export class PrismaOrganizationTenantSource implements TenantSource {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  /**
   * The same walk, minus every organization that is already TERMINAL for all
   * of `migrationNames` - the ones a pass would claim, read, find finished
   * and release, once per organization per pass forever.
   *
   * An organization is kept unless it holds a terminal row for every one of
   * the named migrations, so no row at all, `migrated` or `parked` for even
   * one of them still enumerates it exactly as before. The runner's own
   * cohort check and terminal short-circuit stay the authority on what then
   * happens to it; this only decides who is worth visiting.
   */
  pendingFor({
    migrationNames,
  }: {
    migrationNames: readonly string[];
  }): TenantSource {
    return {
      findTenantIdsAfter: async ({ cursor, limit }) =>
        this.findPendingTenantIdsAfter({ cursor, limit, migrationNames }),
    };
  }

  private async findPendingTenantIdsAfter({
    cursor,
    limit,
    migrationNames,
  }: {
    cursor: string | null;
    limit: number;
    migrationNames: readonly string[];
  }): Promise<string[]> {
    // No migrations to drive means no organization has work, which is not
    // the same question as `count(*) < 0` would ask.
    if (migrationNames.length === 0) return [];
    const names = [...migrationNames];
    const statuses = [...TERMINAL_TENANT_STATUSES];
    // The counted subquery rather than a NOT EXISTS: the tenant is done only
    // when EVERY named migration has latched, and `SystemMigrationTenantState`
    // is keyed `(migrationName, tenantId)`, so the count cannot double-count
    // a migration and the comparison is exact.
    //
    // The `@tenancy` opt-out is required and correct: this asks which
    // organizations a pass has work for across the whole installation, and
    // the answer IS the tenant list, so it cannot be scoped by one.
    // `Organization` is a top-level tenancy entity and
    // `SystemMigrationTenantState` is generic over tenants by design - its
    // `tenantId` is whatever axis the migration runs on, never a scope.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      -- @tenancy: the tenant source itself; an installation-wide walk whose
      -- answer is the list of organizations a pass drives
      SELECT o."id"
      FROM "Organization" o
      WHERE (${cursor}::text IS NULL OR o."id" > ${cursor}::text)
        AND (
          SELECT count(*)
          FROM "SystemMigrationTenantState" s
          WHERE s."tenantId" = o."id"
            AND s."migrationName" = ANY(${names}::text[])
            AND s."status" = ANY(${statuses}::text[])
        ) < ${names.length}::int
      ORDER BY o."id" ASC
      LIMIT ${limit}::int
    `;
    return rows.map((row) => row.id);
  }
}
