/**
 * @vitest-environment node
 *
 * The cohort's eligibility predicate against real rows: the unit suite pins
 * the Prisma where-shape, but only a database proves the shape means what it
 * says — that an enterprise subscription (active or pending) keeps its
 * organization out of the pool, an enrollment row keeps its organization out,
 * and a plain organization stays in.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 *
 * @see specs/migration/system-migrations-runner.feature
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PrismaSystemMigrationEnrollmentRepository } from "../prisma.system-migration-enrollment.repository";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given organizations of every eligibility kind", () => {
  let connection: PrismaConnection;
  let prisma: PrismaClient;
  const ns = `cohort-eligibility-${randomUUID().slice(0, 8)}`;
  const MIGRATION = `authz-test-migration-${ns}`;

  let repository: PrismaSystemMigrationEnrollmentRepository;
  let plainOrgId: string;
  let enterpriseOrgId: string;
  let pendingEnterpriseOrgId: string;
  let cancelledEnterpriseOrgId: string;
  let enrolledOrgId: string;
  let excludedOrgId: string;

  beforeAll(async () => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    repository = new PrismaSystemMigrationEnrollmentRepository(prisma);

    const make = (label: string) =>
      prisma.organization.create({
        data: { name: `Cohort ${label} ${ns}`, slug: `--test-${label}-${ns}` },
      });

    const [plain, enterprise, pending, cancelled, enrolled, excluded] = await Promise.all([
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
    await prisma.$disconnect();
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
