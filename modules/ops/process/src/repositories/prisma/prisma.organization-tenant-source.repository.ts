import { skipTenantCheck } from "@langwatch/prisma-client";
import { TERMINAL_TENANT_STATUSES, type TenantSource } from "@langwatch/system-migrations";
import { ledgerTables, type UpgradePostgres } from "@langwatch/upgrade";

import type { OrganizationTenantSourceRepository } from "../tenant-source.repository.ts";

// The tenant source itself: an installation-wide walk whose answer IS the list of
// organizations a pass drives.
const TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

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
  $queryRawUnsafe<Row>(query: string, ...values: unknown[]): Promise<Row[]>;
};

/**
 * Tenants for the migration runner are organizations, walked in id order so
 * a pass is stable however often it restarts.
 */
export class PrismaOrganizationTenantSourceRepository implements OrganizationTenantSourceRepository {
  static create({
    prisma,
  }: {
    prisma: PrismaOrganizationTenantDatabase;
  }): PrismaOrganizationTenantSourceRepository {
    return new PrismaOrganizationTenantSourceRepository(prisma);
  }

  /** The declared steps' state table, beside the ledger; resolved once per repository. */
  private readonly ledger: UpgradePostgres;

  private constructor(private readonly prisma: PrismaOrganizationTenantDatabase) {
    this.ledger = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await prisma.$queryRawUnsafe<Row>(`${TENANCY}${text}`, ...values),
      }),
    };
  }

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
    const { tenantState } = await ledgerTables({ postgres: this.ledger });
    // A counted subquery rather than NOT EXISTS: the tenant is done only when EVERY named step
    // has finished, and the step state table is keyed (step_id, tenant_id), so it cannot
    // double-count.
    const { rows } = await this.ledger.query<{ id: string }>(
      `SELECT o."id"
         FROM "Organization" o
        WHERE ($1::text IS NULL OR o."id" > $1::text)
          AND (SELECT count(*)
                 FROM ${tenantState} s
                WHERE s."tenant_id" = o."id"
                  AND s."step_id" = ANY($2::text[])
                  AND s."status" = ANY($3::text[])) < $4::int
        ORDER BY o."id" ASC
        LIMIT $5::int`,
      [cursor, names, statuses, names.length, limit],
    );

    return rows.map((row) => row.id);
  }
}
