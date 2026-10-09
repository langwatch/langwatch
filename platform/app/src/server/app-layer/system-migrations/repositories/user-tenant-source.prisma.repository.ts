import {
  TERMINAL_TENANT_STATUSES,
  type TenantSource,
} from "@langwatch/system-migrations";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Tenants for the USER-rooted migration pass are users, walked in id order
 * (ADR-101 §6: the identity migrations' tenant is the user, because a user
 * can belong to many organizations or none). Same paging contract as the
 * organization source, so the generic runner drives both unchanged.
 */
export class PrismaUserTenantSource implements TenantSource {
  constructor(private readonly prisma: PrismaClient) {}

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

  /**
   * The same walk, minus every user that is already TERMINAL for all of
   * `migrationNames`.
   *
   * The user leg is the expensive one: a claim, a state read per migration
   * and a release for each of thousands of users who finished months ago,
   * twice over before a process may serve. A user is kept unless they hold a
   * terminal row for every one of the named migrations, so no row at all,
   * `migrated` or `parked` for even one of them still enumerates them
   * exactly as before, and the runner's cohort check and terminal
   * short-circuit remain the authority on what happens next.
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
    // No migrations to drive means no user has work, which is not the same
    // question as `count(*) < 0` would ask.
    if (migrationNames.length === 0) return [];
    const names = [...migrationNames];
    const statuses = [...TERMINAL_TENANT_STATUSES];
    // The counted subquery rather than a NOT EXISTS: the tenant is done only
    // when EVERY named migration has latched, and `SystemMigrationTenantState`
    // is keyed `(migrationName, tenantId)`, so the count cannot double-count
    // a migration and the comparison is exact.
    //
    // The `@tenancy` opt-out is required and correct: this asks which users a
    // pass has work for across the whole installation, and the answer IS the
    // tenant list, so it cannot be scoped by one. `User` is an identity table
    // under the multitenancy exemption and `SystemMigrationTenantState` is
    // generic over tenants by design - its `tenantId` is whatever axis the
    // migration runs on, never a scope.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      -- @tenancy: the tenant source itself; an installation-wide walk whose
      -- answer is the list of users a pass drives
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

/**
 * One organization's member users, for the targeted "run now" action on a
 * user-rooted migration: the operator names an organization (pacing stays
 * org-driven) and the pass drives its members.
 */
export class PrismaOrganizationMemberTenantSource implements TenantSource {
  private readonly prisma: PrismaClient;
  private readonly organizationId: string;

  constructor({
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
