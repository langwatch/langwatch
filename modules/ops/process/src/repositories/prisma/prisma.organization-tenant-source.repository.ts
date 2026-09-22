import { TERMINAL_TENANT_STATUSES, type TenantSource } from "@langwatch/system-migrations";

/** The rows this source walks, and nothing else it could reach. */
export type PrismaOrganizationTenantDatabase = {
  organization: {
    findMany(args: {
      where: { id?: { gt: string } };
      orderBy: { id: "asc" };
      select: { id: true };
      take: number;
    }): Promise<{ id: string }[]>;
  };
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<{ id: string }[]>;
};

/**
 * Tenants for the migration runner are organizations, walked in id order so
 * a pass is stable however often it restarts.
 */
export class PrismaOrganizationTenantSourceRepository implements TenantSource {
  static create({
    prisma,
  }: {
    prisma: PrismaOrganizationTenantDatabase;
  }): PrismaOrganizationTenantSourceRepository {
    return new PrismaOrganizationTenantSourceRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaOrganizationTenantDatabase) {}

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

  /** The same walk, minus every organization already TERMINAL for ALL of
   *  `migrationNames` — the ones a pass claims, reads, finds finished and
   *  releases, per replica, forever. This decides only who is worth
   *  visiting; the runner still decides what a visit concludes. */
  pendingFor({ migrationNames }: { migrationNames: readonly string[] }): TenantSource {
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
    // the question `count(*) < 0` would ask.
    if (migrationNames.length === 0) return [];
    const names = [...migrationNames];
    const statuses = [...TERMINAL_TENANT_STATUSES];
    // A counted subquery rather than NOT EXISTS: the tenant is done only when
    // EVERY named migration has latched, and `SystemMigrationTenantState` is
    // keyed `(migrationName, tenantId)`, so the count cannot double-count.
    const rows = await this.prisma.$queryRaw`
      -- @tenancy: the tenant source itself; an installation-wide walk whose
      -- answer IS the list of organizations a pass drives
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
