import { guardOrganizationId } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SystemMigration } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";
import { PrismaSystemMigrationEnrollmentRepository } from "../../repositories/prisma/prisma.system-migration-enrollment.repository.ts";
import { PostgresSystemMigrationsAdapter } from "../postgres.system-migrations.adapter.ts";

const IDENTIFIER_BACKFILL = "identity-d01-identifier-backfill";

function migrationOf({
  name,
  enrolledAutomatically = false,
  executionMode,
}: {
  name: string;
  enrolledAutomatically?: boolean;
  executionMode?: "background" | "startup";
}): SystemMigration {
  return {
    executionMode,
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically,
    migrateTenant: vi.fn(async () => ({ status: "finalized" as const })),
  };
}

/**
 * Storage is faked; the cohort composition is what is under test. The
 * membership delegate runs the REAL organization tenancy guard, so a probe
 * spanning every organization at once (ADR-021) fails here rather than ships.
 */
function stubDatabase({
  enrollments,
  memberships,
}: {
  enrollments: Array<{ organizationId: string; migrationName: string }>;
  memberships: Record<string, string[]>;
}) {
  const findFirst = vi.fn(
    async (args: { where: { userId: string; organizationId: { in: string[] } } }) =>
      guardOrganizationId({ model: "OrganizationUser", action: "findFirst", args }, async () =>
        (memberships[args.where.userId] ?? []).some((organizationId) =>
          args.where.organizationId.in.includes(organizationId),
        )
          ? { userId: args.where.userId }
          : null,
      ),
  );
  const findMany = vi.fn().mockResolvedValue([]);
  return {
    findFirst,
    findMany,
    database: {
      systemMigrationEnrollment: { findMany: vi.fn().mockResolvedValue(enrollments) },
      // Both legs page their tenants before claiming any; an empty page ends
      // the leg without touching Redis.
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      organizationUser: { findFirst, findMany },
    } as unknown as PrismaClient,
  };
}

function adapterOn(database: PrismaClient, newbornSweep = vi.fn(async () => undefined)) {
  return {
    newbornSweep,
    adapter: PostgresSystemMigrationsAdapter.create({
      database,
      redis: null,
      isSaaS: () => true,
      migrations: () => [],
      userMigrations: () => [migrationOf({ name: IDENTIFIER_BACKFILL })],
      newbornSweep,
    }),
  };
}

describe("PostgresSystemMigrationsAdapter", () => {
  describe("when one organization is enrolled in the identifier backfill and another is not", () => {
    /** @scenario "Organization enrollment is what puts a user in the backfill's cohort" */
    it("admits exactly the enrolled organizations' members; org-less users stay out", async () => {
      const { database, findFirst, findMany } = stubDatabase({
        enrollments: [{ organizationId: "org_acme", migrationName: IDENTIFIER_BACKFILL }],
        memberships: {
          user_sam: ["org_acme"],
          user_ann: ["org_acme"],
          user_gil: ["org_globex"],
        },
      });
      const { adapter } = adapterOn(database);

      const cohort = await adapter.userCohort({
        isSaaS: true,
        enrollments: enrollmentsOf(database),
        migrations: [migrationOf({ name: IDENTIFIER_BACKFILL })],
      });

      await expect(
        cohort({ tenantId: "user_sam", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_ann", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_gil", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(false);
      await expect(
        cohort({ tenantId: "user_solo", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(false);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user_sam",
            organizationId: { in: ["org_acme"] },
          }),
        }),
      );
      expect(findMany).not.toHaveBeenCalled();
    });

    it("reads no membership and admits nobody when nothing is enrolled", async () => {
      const { database, findFirst } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter } = adapterOn(database);

      const cohort = await adapter.userCohort({
        isSaaS: true,
        enrollments: enrollmentsOf(database),
        migrations: [migrationOf({ name: IDENTIFIER_BACKFILL })],
      });

      await expect(
        cohort({ tenantId: "user_sam", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("admits every user for a migration that enrolls automatically", async () => {
      const { database, findFirst } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter } = adapterOn(database);

      const cohort = await adapter.userCohort({
        isSaaS: true,
        enrollments: enrollmentsOf(database),
        migrations: [migrationOf({ name: "identity-automatic", enrolledAutomatically: true })],
      });

      await expect(
        cohort({ tenantId: "user_solo", migrationName: "identity-automatic" }),
      ).resolves.toBe(true);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  describe("when a pass runs", () => {
    /** @scenario "The reconciliation sweep runs on every migration pass" */
    it("sweeps abandoned newborn streams alongside the migrations", async () => {
      const { database } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter, newbornSweep } = adapterOn(database);

      await adapter.runPass({});

      expect(newbornSweep).toHaveBeenCalledTimes(1);
    });

    /** @scenario "The reconciliation sweep runs on every migration pass" */
    it("still reports the pass when the sweep itself fails", async () => {
      const { database } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter } = adapterOn(
        database,
        vi.fn(async () => {
          throw new Error("clickhouse unavailable");
        }),
      );

      await expect(adapter.runPass({})).resolves.toMatchObject({ tenantsSeen: 0 });
    });
  });

  describe("when an operator enrols an organization between two passes", () => {
    /** @scenario Enrolling an organization takes effect on the next pass */
    it("reads enrollment fresh on each pass rather than caching the first answer", async () => {
      const enrollmentReads = vi.fn().mockResolvedValue([]);
      const database = {
        systemMigrationEnrollment: { findMany: enrollmentReads },
        organization: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findMany: vi.fn().mockResolvedValue([]) },
        organizationUser: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as PrismaClient;
      const { adapter } = adapterOn(database);

      await adapter.runPass({});
      const afterFirstPass = enrollmentReads.mock.calls.length;
      enrollmentReads.mockResolvedValue([
        { organizationId: "org_acme", migrationName: IDENTIFIER_BACKFILL },
      ]);
      await adapter.runPass({});

      // The second pass reads enrollment again, so an enrolment made between
      // the two is what it paces on. A cohort cached across passes would not.
      expect(afterFirstPass).toBeGreaterThan(0);
      expect(enrollmentReads.mock.calls.length).toBeGreaterThan(afterFirstPass);
    });
  });
});

/** The pass's own enrollment reader, over the same faked storage. */
function enrollmentsOf(database: PrismaClient) {
  return PrismaSystemMigrationEnrollmentRepository.create({ prisma: database });
}
