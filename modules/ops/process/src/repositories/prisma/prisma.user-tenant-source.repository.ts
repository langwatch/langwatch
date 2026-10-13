import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { TERMINAL_TENANT_STATUSES, type TenantSource } from "@langwatch/system-migrations";
import { ledgerTables, type UpgradePostgres } from "@langwatch/upgrade";

import type {
  OrganizationMemberTenantSourceRepository,
  UserTenantSourceRepository,
} from "../tenant-source.repository.ts";

// The tenant source itself: an installation-wide walk whose answer IS the list of
// users a pass drives.
const TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

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
  $queryRawUnsafe<Row>(query: string, ...values: unknown[]): Promise<Row[]>;
};

/** Tenants for USER-rooted migration pass are users walked in id order.
 * Same paging contract as organization source. */
export class PrismaUserTenantSourceRepository implements UserTenantSourceRepository {
  static create({
    prisma,
  }: {
    prisma: PrismaUserTenantDatabase;
  }): PrismaUserTenantSourceRepository {
    return new PrismaUserTenantSourceRepository(prisma);
  }

  /** The declared steps' state table, beside the ledger; resolved once per repository. */
  private readonly ledger: UpgradePostgres;

  private constructor(private readonly prisma: PrismaUserTenantDatabase) {
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
    const { tenantState } = await ledgerTables({ postgres: this.ledger });
    // A counted subquery rather than NOT EXISTS: the tenant is done only when EVERY named step
    // has finished, and the step state table is keyed (step_id, tenant_id), so it cannot
    // double-count.
    const { rows } = await this.ledger.query<{ id: string }>(
      `SELECT u."id"
         FROM "User" u
        WHERE ($1::text IS NULL OR u."id" > $1::text)
          AND (SELECT count(*)
                 FROM ${tenantState} s
                WHERE s."tenant_id" = u."id"
                  AND s."step_id" = ANY($2::text[])
                  AND s."status" = ANY($3::text[])) < $4::int
        ORDER BY u."id" ASC
        LIMIT $5::int`,
      [cursor, names, statuses, names.length, limit],
    );

    return rows.map((row) => row.id);
  }
}

/** One organization's member users, for a targeted run of a user-rooted migration. */
export class PrismaOrganizationMemberTenantSourceRepository implements OrganizationMemberTenantSourceRepository {
  static create({
    prisma,
  }: {
    prisma: PrismaClient;
  }): PrismaOrganizationMemberTenantSourceRepository {
    return new PrismaOrganizationMemberTenantSourceRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  membersOf({ organizationId }: { organizationId: string }): TenantSource {
    return {
      findTenantIdsAfter: async ({ cursor, limit }) => {
        const rows = await this.prisma.organizationUser.findMany({
          where: {
            organizationId,
            ...(cursor === null ? {} : { userId: { gt: cursor } }),
          },
          orderBy: { userId: "asc" },
          select: { userId: true },
          take: limit,
        });
        return rows.map((row) => row.userId);
      },
    };
  }
}
