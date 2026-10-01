import {
  MigrationEnrollmentAlreadyExistsError,
  MigrationEnrollmentNotFoundError,
  MigrationEnrollmentOrganizationNotFoundError,
} from "@langwatch/ops-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type { MigrationEnrollmentRecord } from "../../services/system-migrations.service.ts";

/** Cloud rollout enrollment rows: which organizations each migration processes.
 * Uniqueness checks live here as the only race-free duplicate check. */
export class PrismaSystemMigrationEnrollmentRepository {
  static create({ prisma }: { prisma: PrismaClient }): PrismaSystemMigrationEnrollmentRepository {
    return new PrismaSystemMigrationEnrollmentRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  /** Every enrollment with organization and enroller names. Both are best-effort
   * lookups so enrollment must list even when organization/enroller is deleted. */
  async findAll(): Promise<MigrationEnrollmentRecord[]> {
    const rows = await this.prisma.systemMigrationEnrollment.findMany({
      orderBy: { createdAt: "desc" },
    });
    if (rows.length === 0) return [];
    const [organizations, users] = await Promise.all([
      this.prisma.organization.findMany({
        where: { id: { in: rows.map((row) => row.organizationId) } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: rows.map((row) => row.enrolledByUserId) } },
        // Name only, never the email: the listing is a plain ops read with no
        // audit trail of its own, so it must not carry PII - a user with no
        // name falls back to the user id the record already carries.
        select: { id: true, name: true },
      }),
    ]);
    const organizationNames = new Map(
      organizations.map((organization) => [organization.id, organization.name]),
    );
    const userLabels = new Map(users.map((user) => [user.id, user.name ?? null]));
    return rows.map((row) => ({
      organizationId: row.organizationId,
      organizationName: organizationNames.get(row.organizationId) ?? null,
      migrationName: row.migrationName,
      enrolledByUserId: row.enrolledByUserId,
      enrolledByLabel: userLabels.get(row.enrolledByUserId) ?? null,
      createdAt: row.createdAt,
    }));
  }

  /**
   * The pass's read: every enrollment as migration-name → organization-id sets, so the
   * runner probes per (tenant, migration) in memory. Read once at the start of each pass -
   * fresh per pass, and one query instead of one per tenant per migration.
   */
  async findEnrolledOrganizationIdsByMigration(): Promise<Map<string, Set<string>>> {
    const rows = await this.prisma.systemMigrationEnrollment.findMany({
      select: { organizationId: true, migrationName: true },
    });
    const byMigration = new Map<string, Set<string>>();
    for (const row of rows) {
      const ids = byMigration.get(row.migrationName) ?? new Set<string>();
      ids.add(row.organizationId);
      byMigration.set(row.migrationName, ids);
    }
    return byMigration;
  }

  /** The cutover's per-tenant probe, and the targeted run's precondition. */
  async isEnrolled({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): Promise<boolean> {
    const row = await this.prisma.systemMigrationEnrollment.findUnique({
      where: {
        organizationId_migrationName: { organizationId, migrationName },
      },
      select: { organizationId: true },
    });
    return row !== null;
  }

  /** How many organizations are enrolled, per migration name. */
  async countEnrolledByMigration(): Promise<Map<string, number>> {
    const groups = await this.prisma.systemMigrationEnrollment.groupBy({
      by: ["migrationName"],
      _count: { organizationId: true },
    });
    return new Map(groups.map((group) => [group.migrationName, group._count.organizationId]));
  }

  /** Every organization on the installation - the enrollment ceiling. */
  async countOrganizations(): Promise<number> {
    return this.prisma.organization.count();
  }

  /** The service's existence check for the organization being enrolled. */
  async getOrganizationById({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!organization) throw new MigrationEnrollmentOrganizationNotFoundError();
    return organization;
  }

  /**
   * The operator's organization lookup: by name (contains, case-insensitive)
   * or exact id, a short list for a picker. Name and id only - the ops page
   * needs nothing else to act on an organization.
   */
  async searchOrganizations({ query }: { query: string }): Promise<{ id: string; name: string }[]> {
    return this.prisma.organization.findMany({
      where: {
        OR: [{ name: { contains: query, mode: "insensitive" } }, { id: query }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 10,
    });
  }

  /** Cohort eligible pool: organizations not enrolled, not on exclusion list,
   * optionally filtered by predecessor enrollment. Ids and names only. */
  async findCohortEligibleOrganizations({
    migrationName,
    enrolledForMigrationName,
    excludeOrganizationIds,
    includeEnterprise = false,
  }: {
    migrationName: string;
    enrolledForMigrationName?: string;
    excludeOrganizationIds: string[];
    includeEnterprise?: boolean;
  }): Promise<{ id: string; name: string }[]> {
    // Enrollment table has no Organization relation; enrolled ids read first.
    // Enrolled set is the small side of this join.
    const enrolled = await this.prisma.systemMigrationEnrollment.findMany({
      where: { migrationName },
      select: { organizationId: true },
    });
    const pool =
      enrolledForMigrationName === undefined
        ? undefined
        : (
            await this.prisma.systemMigrationEnrollment.findMany({
              where: { migrationName: enrolledForMigrationName },
              select: { organizationId: true },
            })
          ).map((row) => row.organizationId);
    return this.prisma.organization.findMany({
      where: {
        id: {
          ...(pool === undefined ? {} : { in: pool }),
          notIn: [...excludeOrganizationIds, ...enrolled.map((row) => row.organizationId)],
        },
        // PENDING rides with ACTIVE; exclude unsettled enterprise subscriptions.
        ...(includeEnterprise
          ? {}
          : {
              subscriptions: {
                none: {
                  status: { in: ["ACTIVE", "PENDING"] },
                  plan: "ENTERPRISE",
                },
              },
            }),
      },
      select: { id: true, name: true },
    });
  }

  /** Cohort write: every picked organization in one statement. skipDuplicates
   * covers race with concurrent enrollment. */
  async createMany({
    organizationIds,
    migrationName,
    enrolledByUserId,
  }: {
    organizationIds: string[];
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<{ insertedCount: number }> {
    if (organizationIds.length === 0) return { insertedCount: 0 };
    const result = await this.prisma.systemMigrationEnrollment.createMany({
      data: organizationIds.map((organizationId) => ({
        organizationId,
        migrationName,
        enrolledByUserId,
      })),
      skipDuplicates: true,
    });
    return { insertedCount: result.count };
  }

  async create({
    organizationId,
    migrationName,
    enrolledByUserId,
  }: {
    organizationId: string;
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<void> {
    try {
      await this.prisma.systemMigrationEnrollment.create({
        data: { organizationId, migrationName, enrolledByUserId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new MigrationEnrollmentAlreadyExistsError({ migrationName });
      }
      throw error;
    }
  }

  async delete({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): Promise<void> {
    try {
      await this.prisma.systemMigrationEnrollment.delete({
        where: {
          organizationId_migrationName: { organizationId, migrationName },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new MigrationEnrollmentNotFoundError({ migrationName });
      }
      throw error;
    }
  }
}
