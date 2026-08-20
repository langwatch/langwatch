import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import {
  MigrationEnrollmentAlreadyExistsError,
  MigrationEnrollmentNotFoundError,
} from "../errors";
import type {
  MigrationEnrollmentRecord,
  MigrationEnrollmentStage,
} from "../system-migrations.service";

/**
 * The cloud rollout's enrollment rows (`SystemMigrationEnrollment`): which
 * organizations the runner processes ("migrations") and which the cutover
 * may flip ("cutover"). One row per (organization, stage); withdrawal
 * deletes the row. The uniqueness refusals live here because the unique key
 * is the only race-free duplicate check - the service adds the guards that
 * are business rules rather than storage facts.
 */
export class PrismaSystemMigrationEnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * One stage's enrollments with the names the ops page shows - the
   * organization's, and something readable for who enrolled it. Both are
   * best-effort lookups: an enrollment must still list (and be
   * withdrawable) when its organization or enroller has since been deleted.
   */
  async findAllByStage({
    stage,
  }: {
    stage: MigrationEnrollmentStage;
  }): Promise<MigrationEnrollmentRecord[]> {
    const rows = await this.prisma.systemMigrationEnrollment.findMany({
      where: { stage },
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
      stage,
      enrolledByUserId: row.enrolledByUserId,
      enrolledByLabel: userLabels.get(row.enrolledByUserId) ?? null,
      createdAt: row.createdAt,
    }));
  }

  /**
   * The pass's read: every organization enrolled for one stage, as a set the
   * runner probes per tenant. Read once at the start of each pass - fresh
   * per pass, like the env knob it replaced, and one query instead of one
   * per tenant.
   */
  async findEnrolledOrganizationIds({
    stage,
  }: {
    stage: MigrationEnrollmentStage;
  }): Promise<Set<string>> {
    const rows = await this.prisma.systemMigrationEnrollment.findMany({
      where: { stage },
      select: { organizationId: true },
    });
    return new Set(rows.map((row) => row.organizationId));
  }

  /** The cutover's per-tenant probe (only tenants past their prerequisites reach it). */
  async isEnrolled({
    organizationId,
    stage,
  }: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
  }): Promise<boolean> {
    const row = await this.prisma.systemMigrationEnrollment.findUnique({
      where: { organizationId_stage: { organizationId, stage } },
      select: { organizationId: true },
    });
    return row !== null;
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

  async create({
    organizationId,
    stage,
    enrolledByUserId,
  }: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
    enrolledByUserId: string;
  }): Promise<void> {
    try {
      await this.prisma.systemMigrationEnrollment.create({
        data: { organizationId, stage, enrolledByUserId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new MigrationEnrollmentAlreadyExistsError({ stage });
      }
      throw error;
    }
  }

  async delete({
    organizationId,
    stage,
  }: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
  }): Promise<void> {
    try {
      await this.prisma.systemMigrationEnrollment.delete({
        where: { organizationId_stage: { organizationId, stage } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new MigrationEnrollmentNotFoundError({ stage });
      }
      throw error;
    }
  }
}
