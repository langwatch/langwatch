/**
 * The cohort's eligibility predicate against real rows: the unit suite pins
 * the Prisma where-shape, but only a database proves the shape means what it
 * says — that an enterprise subscription (active or pending) keeps its
 * organization out of the pool, an enrollment row keeps its organization out,
 * and a plain organization stays in.
 *
 * @see specs/migration/system-migrations-runner.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSystemMigrationEnrollmentRepository } from "../system-migration-enrollment.prisma.repository";

const ns = `cohort-eligibility-${nanoid(8)}`;
const MIGRATION = `authz-test-migration-${ns}`;

describe("given organizations of every eligibility kind", () => {
  const repository = new PrismaSystemMigrationEnrollmentRepository(prisma);
  let plainOrgId: string;
  let enterpriseOrgId: string;
  let pendingEnterpriseOrgId: string;
  let cancelledEnterpriseOrgId: string;
  let enrolledOrgId: string;
  let excludedOrgId: string;

  beforeAll(async () => {
    const make = (label: string) =>
      prisma.organization.create({
        data: { name: `Cohort ${label} ${ns}`, slug: `--test-${label}-${ns}` },
      });

    const [plain, enterprise, pending, cancelled, enrolled, excluded] =
      await Promise.all([
        make("plain"),
        make("enterprise"),
        make("pending-ent"),
        make("cancelled-ent"),
        make("enrolled"),
        make("excluded"),
      ]);
    plainOrgId = plain.id;
    enterpriseOrgId = enterprise.id;
    pendingEnterpriseOrgId = pending.id;
    cancelledEnterpriseOrgId = cancelled.id;
    enrolledOrgId = enrolled.id;
    excludedOrgId = excluded.id;

    await prisma.subscription.createMany({
      data: [
        {
          organizationId: enterpriseOrgId,
          plan: "ENTERPRISE",
          status: "ACTIVE",
        },
        {
          organizationId: pendingEnterpriseOrgId,
          plan: "ENTERPRISE",
          status: "PENDING",
        },
        // A cancelled enterprise is formally free — the plan provider itself
        // honours only ACTIVE — so it stays eligible on purpose.
        {
          organizationId: cancelledEnterpriseOrgId,
          plan: "ENTERPRISE",
          status: "CANCELLED",
        },
      ],
    });
    await prisma.systemMigrationEnrollment.create({
      data: {
        organizationId: enrolledOrgId,
        migrationName: MIGRATION,
        enrolledByUserId: `user-${ns}`,
      },
    });
  });

  afterAll(async () => {
    const orgIds = [
      plainOrgId,
      enterpriseOrgId,
      pendingEnterpriseOrgId,
      cancelledEnterpriseOrgId,
      enrolledOrgId,
      excludedOrgId,
    ].filter((id): id is string => typeof id === "string");
    // The tenancy guard requires the organizationId key on this model's
    // deletes, so the sweep names the rows by owner as well as by migration.
    await prisma.systemMigrationEnrollment.deleteMany({
      where: { organizationId: { in: orgIds }, migrationName: MIGRATION },
    });
    await prisma.subscription.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  describe("when the cohort's eligible pool is read", () => {
    /** @scenario "A cohort leaves out an enterprise organization by default" */
    /** @scenario "A cohort samples only organizations not already enrolled" */
    it("holds the plain and cancelled-enterprise organizations and nothing excluded", async () => {
      const pool = await repository.findCohortEligibleOrganizations({
        migrationName: MIGRATION,
        excludeOrganizationIds: [excludedOrgId],
      });
      const poolIds = new Set(pool.map((organization) => organization.id));

      expect(poolIds.has(plainOrgId)).toBe(true);
      expect(poolIds.has(cancelledEnterpriseOrgId)).toBe(true);
      expect(poolIds.has(enterpriseOrgId)).toBe(false);
      expect(poolIds.has(pendingEnterpriseOrgId)).toBe(false);
      expect(poolIds.has(enrolledOrgId)).toBe(false);
      expect(poolIds.has(excludedOrgId)).toBe(false);
    });

    /** @scenario "An operator can draw enterprise organizations into a cohort" */
    it("holds the enterprise organizations when the exclusion is lifted", async () => {
      const pool = await repository.findCohortEligibleOrganizations({
        migrationName: MIGRATION,
        excludeOrganizationIds: [excludedOrgId],
        includeEnterprise: true,
      });
      const poolIds = new Set(pool.map((organization) => organization.id));

      expect(poolIds.has(enterpriseOrgId)).toBe(true);
      expect(poolIds.has(pendingEnterpriseOrgId)).toBe(true);
      // Lifting ONE exclusion lifts only that one: an already-enrolled
      // organization and a caller-excluded id stay out regardless.
      expect(poolIds.has(enrolledOrgId)).toBe(false);
      expect(poolIds.has(excludedOrgId)).toBe(false);
    });

    /** @scenario "A later step's cohort samples only organizations enrolled for the step before it" */
    it("narrows to the predecessor's enrollment when one is named", async () => {
      const laterStep = `${MIGRATION}-later`;
      // Only the organization already enrolled for MIGRATION (the
      // predecessor here) may enter the later step's pool; the plain
      // organization, eligible for the first step, is not enrolled for the
      // predecessor and stays out.
      const pool = await repository.findCohortEligibleOrganizations({
        migrationName: laterStep,
        enrolledForMigrationName: MIGRATION,
        excludeOrganizationIds: [],
      });
      const poolIds = new Set(pool.map((organization) => organization.id));

      expect(poolIds.has(enrolledOrgId)).toBe(true);
      expect(poolIds.has(plainOrgId)).toBe(false);
    });
  });
});
