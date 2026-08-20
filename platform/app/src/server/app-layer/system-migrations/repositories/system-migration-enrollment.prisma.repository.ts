import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import {
  MigrationEnrollmentAlreadyExistsError,
  MigrationEnrollmentNotFoundError,
} from "../errors";
import type { MigrationEnrollmentRecord } from "../system-migrations.service";

/**
 * The cloud rollout's enrollment rows (`SystemMigrationEnrollment`): which
 * organizations each registered migration processes, one row per
 * (organization, migration); withdrawal deletes the row. The uniqueness
 * refusals live here because the unique key is the only race-free duplicate
 * check - the service adds the guards that are business rules rather than
 * storage facts.
 */
export class PrismaSystemMigrationEnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Every enrollment with the names the ops page shows - the organization's,
   * and something readable for who enrolled it. Both are best-effort
   * lookups: an enrollment must still list (and be withdrawable) when its
   * organization or enroller has since been deleted.
   */
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
    const userLabels = new Map(
      users.map((user) => [user.id, user.name ?? null]),
    );
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
   * The pass's read: every enrollment as migration-name → organization-id
   * sets, so the runner probes per (tenant, migration) in memory. Read once
   * at the start of each pass - fresh per pass, and one query instead of one
   * per tenant per migration.
   */
  async findEnrolledOrganizationIdsByMigration(): Promise<
    Map<string, Set<string>>
  > {
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
    return new Map(
      groups.map((group) => [group.migrationName, group._count.organizationId]),
    );
  }

  /** Every organization on the installation - the enrollment ceiling. */
  async countOrganizations(): Promise<number> {
    return this.prisma.organization.count();
  }

  /** The service's existence check for the organization being enrolled. */
  async findOrganizationById({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
  }

  /**
   * The operator's organization lookup: by name (contains, case-insensitive)
   * or exact id, a short list for a picker. Name and id only - the ops page
   * needs nothing else to act on an organization.
   */
  async searchOrganizations({
    query,
  }: {
    query: string;
  }): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.organization.findMany({
      where: {
        OR: [{ name: { contains: query, mode: "insensitive" } }, { id: query }],
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 10,
    });
  }

  /**
   * The cohort's eligible pool for one migration: organizations with no
   * enrollment row for it, no active enterprise subscription, and not on the
   * caller's exclusion list (the private-dataplane organizations, whose ids
   * the composition reads from the environment). Ids and names only - the
   * service samples from this in memory, so the pool never needs an order.
   */
  async findCohortEligibleOrganizations({
    migrationName,
    excludeOrganizationIds,
  }: {
    migrationName: string;
    excludeOrganizationIds: string[];
  }): Promise<Array<{ id: string; name: string }>> {
    // The enrollment table has no relation to Organization (a plain string
    // column pair), so the enrolled ids are read first and excluded by id -
    // the enrolled set is the small side of this join by construction.
    const enrolled = await this.prisma.systemMigrationEnrollment.findMany({
      where: { migrationName },
      select: { organizationId: true },
    });
    return this.prisma.organization.findMany({
      where: {
        id: {
          notIn: [
            ...excludeOrganizationIds,
            ...enrolled.map((row) => row.organizationId),
          ],
        },
        // PENDING rides along with ACTIVE: a just-signed enterprise whose
        // subscription has not settled is exactly the organization the
        // exclusion exists to keep out of an experimental cohort.
        subscriptions: {
          none: { status: { in: ["ACTIVE", "PENDING"] }, plan: "ENTERPRISE" },
        },
      },
      select: { id: true, name: true },
    });
  }

  /**
   * The cohort's write: every picked organization in one statement.
   * `skipDuplicates` covers the race with a concurrent single enrollment -
   * a row that appeared since the pool was read is simply not re-created,
   * and the returned count is what actually landed, so the caller reports
   * what happened rather than what it attempted.
   */
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new MigrationEnrollmentNotFoundError({ migrationName });
      }
      throw error;
    }
  }
}
