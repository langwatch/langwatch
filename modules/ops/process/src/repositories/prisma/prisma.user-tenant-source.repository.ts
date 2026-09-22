import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { TERMINAL_TENANT_STATUSES, type TenantSource } from "@langwatch/system-migrations";

/** The rows this source walks, and nothing else it could reach. */
export type PrismaUserTenantDatabase = {
  user: {
    findMany(args: {
      where: { id?: { gt: string } };
      orderBy: { id: "asc" };
      select: { id: true };
      take: number;
    }): Promise<{ id: string }[]>;
  };
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<{ id: string }[]>;
};

/** Tenants for USER-rooted migration pass are users walked in id order.
 * Same paging contract as organization source. */
export class PrismaUserTenantSourceRepository implements TenantSource {
  static create({
    prisma,
  }: {
    prisma: PrismaUserTenantDatabase;
  }): PrismaUserTenantSourceRepository {
    return new PrismaUserTenantSourceRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaUserTenantDatabase) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  /** The same walk, minus every user already TERMINAL for ALL of
   *  `migrationNames`. The user leg is the expensive one: a claim, a read
   *  per migration and a release for thousands who finished months ago,
   *  twice over before a process may serve. */
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
    // No migrations to drive means no user has work, which is not the
    // question `count(*) < 0` would ask.
    if (migrationNames.length === 0) return [];
    const names = [...migrationNames];
    const statuses = [...TERMINAL_TENANT_STATUSES];
    // A counted subquery rather than NOT EXISTS: the tenant is done only when
    // EVERY named migration has latched, and `SystemMigrationTenantState` is
    // keyed `(migrationName, tenantId)`, so the count cannot double-count.
    const rows = await this.prisma.$queryRaw`
      -- @tenancy: the tenant source itself; an installation-wide walk whose
      -- answer IS the list of users a pass drives
      SELECT u."id"
      FROM "User" u
      WHERE (${cursor}::text IS NULL OR u."id" > ${cursor}::text)
        AND (
          SELECT count(*)
          FROM "SystemMigrationTenantState" s
          WHERE s."tenantId" = u."id"
            AND s."migrationName" = ANY(${names}::text[])
            AND s."status" = ANY(${statuses}::text[])
        ) < ${names.length}::int
      ORDER BY u."id" ASC
      LIMIT ${limit}::int
    `;

    return rows.map((row) => row.id);
  }
}

/** One organization's member users for targeted "run now" on
 * user-rooted migration. */
export class PrismaOrganizationMemberTenantSourceRepository implements TenantSource {
  private readonly prisma: PrismaClient;
  private readonly organizationId: string;

  static create({
    prisma,
    organizationId,
  }: {
    prisma: PrismaClient;
    organizationId: string;
  }): PrismaOrganizationMemberTenantSourceRepository {
    return new PrismaOrganizationMemberTenantSourceRepository({ prisma, organizationId });
  }

  private constructor({
    prisma,
    organizationId,
  }: {
    prisma: PrismaClient;
    organizationId: string;
  }) {
    this.prisma = prisma;
    this.organizationId = organizationId;
  }

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: {
        organizationId: this.organizationId,
        ...(cursor === null ? {} : { userId: { gt: cursor } }),
      },
      orderBy: { userId: "asc" },
      select: { userId: true },
      take: limit,
    });
    return rows.map((row) => row.userId);
  }
}
