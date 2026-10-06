import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { SystemMigrationRecordNotFoundError } from "@langwatch/system-migrations";
import type { SystemMigration } from "@langwatch/system-migrations";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PostgresOpsRepositories } from "../../repositories/prisma/prisma.ops.repositories.ts";
import { PrismaSystemMigrationEnrollmentRepository } from "../../repositories/prisma/prisma.system-migration-enrollment.repository.ts";
import { PrismaSystemMigrationStateRepository } from "../../repositories/prisma/prisma.system-migration-state.repository.ts";
import { RedisMigrationLeaseRepository } from "../../repositories/redis/redis.migration-lease.repository.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const IDENTIFIER_BACKFILL = "identity-d01-identifier-backfill";

function migrationOf({
  name,
  enrolledAutomatically = false,
  executionMode,
  migrateTenant = vi.fn(async () => ({ status: "finalized" as const })),
}: {
  name: string;
  enrolledAutomatically?: boolean;
  executionMode?: "background" | "startup";
  // Accepted as an override so a caller that needs to assert on calls can
  // keep its own reference to the mock — SystemMigration declares this with
  // method shorthand (a package outside this lane's scope), so asserting via
  // `migration.migrateTenant` would extract it unbound.
  migrateTenant?: SystemMigration["migrateTenant"];
}): SystemMigration {
  return {
    executionMode,
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically,
    migrateTenant,
  };
}

/**
 * Storage is faked; the cohort composition is what is under test. The probe
 * reads the user's own memberships, so no statement grows with the enrolled set.
 */
function stubDatabase({
  enrollments,
  memberships,
}: {
  enrollments: { organizationId: string; migrationName: string }[];
  memberships: Record<string, string[]>;
}) {
  const findUnique = vi.fn(async (args: { where: { id?: string } }) => {
    const organizationIds = memberships[args.where.id ?? ""];
    return organizationIds
      ? { orgMemberships: organizationIds.map((organizationId) => ({ organizationId })) }
      : null;
  });
  const findMany = vi.fn().mockResolvedValue([]);
  const projectFindMany = vi.fn().mockResolvedValue([]);
  const organizationFindMany = vi.fn().mockResolvedValue([]);
  const projectOrganization = vi.fn().mockResolvedValue({ team: { organizationId: "org_acme" } });
  return {
    findUnique,
    findMany,
    projectFindMany,
    organizationFindMany,
    projectOrganization,
    database: prismaDouble({
      systemMigrationEnrollment: { findMany: vi.fn().mockResolvedValue(enrollments) },
      // Both legs page their tenants before claiming any, through the walk
      // that skips tenants already terminal for every migration the pass
      // drives; an empty page ends the leg without touching Redis.
      $queryRaw: vi.fn().mockResolvedValue([]),
      organization: { findMany: organizationFindMany },
      project: { findMany: projectFindMany, findUniqueOrThrow: projectOrganization },
      user: { findMany: vi.fn().mockResolvedValue([]), findUnique },
      organizationUser: { findMany },
    }),
  };
}

function adapterOn(database: PrismaClient, newbornSweep = vi.fn(async () => undefined)) {
  return {
    newbornSweep,
    adapter: SystemMigrationPassService.create({
      repositories: passRepositoriesOver(database),
      isSaaS: () => true,
      migrations: () => [],
      userMigrations: () => [migrationOf({ name: IDENTIFIER_BACKFILL })],
      newbornSweep,
    }),
  };
}

function passRepositoriesOver(database: PrismaClient) {
  return {
    ...PostgresOpsRepositories.create({ prisma: database }),
    migrationLease: RedisMigrationLeaseRepository.create({ redis: null }),
  };
}

describe("SystemMigrationPassService", () => {
  describe("when one organization is enrolled in the identifier backfill and another is not", () => {
    /** @scenario "Organization enrollment is what puts a user in the backfill's cohort" */
    it("admits exactly the enrolled organizations' members; org-less users stay out", async () => {
      const { database, findUnique, findMany } = stubDatabase({
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
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "user_sam" },
        select: { orgMemberships: { select: { organizationId: true } } },
      });
      expect(findMany).not.toHaveBeenCalled();
    });

    it("reads no membership and admits nobody when nothing is enrolled", async () => {
      const { database, findUnique } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter } = adapterOn(database);

      const cohort = await adapter.userCohort({
        isSaaS: true,
        enrollments: enrollmentsOf(database),
        migrations: [migrationOf({ name: IDENTIFIER_BACKFILL })],
      });

      await expect(
        cohort({ tenantId: "user_sam", migrationName: IDENTIFIER_BACKFILL }),
      ).resolves.toBe(false);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it("admits every user for a migration that enrolls automatically", async () => {
      const { database, findUnique } = stubDatabase({ enrollments: [], memberships: {} });
      const { adapter } = adapterOn(database);

      const cohort = await adapter.userCohort({
        isSaaS: true,
        enrollments: enrollmentsOf(database),
        migrations: [migrationOf({ name: "identity-automatic", enrolledAutomatically: true })],
      });

      await expect(
        cohort({ tenantId: "user_solo", migrationName: "identity-automatic" }),
      ).resolves.toBe(true);
      expect(findUnique).not.toHaveBeenCalled();
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
      const database = prismaDouble({
        systemMigrationEnrollment: { findMany: enrollmentReads },
        $queryRaw: vi.fn().mockResolvedValue([]),
        organization: { findMany: vi.fn().mockResolvedValue([]) },
        user: { findMany: vi.fn().mockResolvedValue([]) },
        organizationUser: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      });
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

describe("a pass's user-rooted leg", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("given one migration declares its own candidate tenants and another is driven over every user", () => {
    /** @scenario "A migration that declares its own tenants keeps them" */
    it("drives the declaring migration over its candidates and the other over the users with work left", async () => {
      const { database } = stubDatabase({ enrollments: [], memberships: {} });
      vi.spyOn(RedisMigrationLeaseRepository.prototype, "acquire").mockResolvedValue(true);
      vi.spyOn(RedisMigrationLeaseRepository.prototype, "release").mockResolvedValue();
      vi.spyOn(PrismaSystemMigrationStateRepository.prototype, "getRecord").mockImplementation(
        async (args) => {
          throw new SystemMigrationRecordNotFoundError(args);
        },
      );
      vi.spyOn(
        PrismaSystemMigrationStateRepository.prototype,
        "upsertRecordUnlessRolledBack",
      ).mockResolvedValue(true);
      const migrateDrifted = vi.fn(async () => ({ status: "finalized" as const }));
      const migrateEveryone = vi.fn(async () => ({ status: "finalized" as const }));
      const declaring: SystemMigration = {
        ...migrationOf({
          name: "heal",
          enrolledAutomatically: true,
          migrateTenant: migrateDrifted,
        }),
        candidateTenants: pageOf(["user_drifted"]),
      };
      const everyone = migrationOf({
        name: "backfill",
        enrolledAutomatically: true,
        migrateTenant: migrateEveryone,
      });
      const pendingFor = vi.fn(() => pageOf(["user_with_work_left"]));
      const adapter = SystemMigrationPassService.create({
        repositories: {
          ...passRepositoriesOver(database),
          userTenants: {
            findTenantIdsAfter: async () => ["user_a", "user_b", "user_with_work_left"],
            pendingFor,
          },
        },
        isSaaS: () => true,
        migrations: () => [],
        userMigrations: () => [everyone, declaring],
        newbornSweep: async () => {},
      });

      await adapter.runPass({});

      expect(migrateDrifted).toHaveBeenCalledTimes(1);
      expect(migrateDrifted).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "user_drifted" }),
      );
      expect(migrateEveryone).toHaveBeenCalledTimes(1);
      expect(migrateEveryone).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "user_with_work_left" }),
      );
      // The narrowing is asked for the migrations the bucket drives, never the declaring one's.
      expect(pendingFor).toHaveBeenCalledTimes(1);
      expect(pendingFor).toHaveBeenCalledWith({ migrationNames: ["backfill"] });
    });
  });
});

function pageOf(ids: string[]) {
  return {
    async findTenantIdsAfter({ cursor }: { cursor: string | null }): Promise<string[]> {
      return cursor === null ? ids : [];
    },
  };
}

/** The pass's own enrollment reader, over the same faked storage. */
function enrollmentsOf(database: PrismaClient) {
  return PrismaSystemMigrationEnrollmentRepository.create({ prisma: database });
}

describe("project-rooted migration composition", () => {
  afterEach(() => vi.restoreAllMocks());

  /** @scenario "A project-rooted migration keeps enrollment and execution axes distinct" */
  it("uses project ids for execution and checkpoints, but organization ids for cloud enrollment", async () => {
    const name = "project-audit-repair";
    const { database, projectFindMany, projectOrganization } = stubDatabase({
      enrollments: [{ organizationId: "org_acme", migrationName: name }],
      memberships: {},
    });
    projectFindMany.mockResolvedValueOnce([{ id: "project_1" }]);
    vi.spyOn(RedisMigrationLeaseRepository.prototype, "acquire").mockResolvedValue(true);
    vi.spyOn(RedisMigrationLeaseRepository.prototype, "release").mockResolvedValue();
    vi.spyOn(PrismaSystemMigrationStateRepository.prototype, "getRecord").mockImplementation(
      async (args) => {
        throw new SystemMigrationRecordNotFoundError(args);
      },
    );
    const checkpoint = vi
      .spyOn(PrismaSystemMigrationStateRepository.prototype, "upsertRecordUnlessRolledBack")
      .mockResolvedValue(true);
    const migrateTenant = vi.fn(async () => ({ status: "finalized" as const }));
    const migration = migrationOf({ name, migrateTenant });
    const adapter = SystemMigrationPassService.create({
      repositories: passRepositoriesOver(database),
      isSaaS: () => true,
      tenantAxis: "project",
      migrations: () => [migration],
      userMigrations: () => [],
      newbornSweep: async () => {},
    });

    await expect(adapter.runPass({})).resolves.toMatchObject({ finalized: 1 });

    expect(migrateTenant).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "project_1" }));
    expect(checkpoint).toHaveBeenCalledWith({
      migrationName: name,
      tenantId: "project_1",
      status: "finalized",
      report: null,
    });
    expect(projectOrganization).toHaveBeenCalledWith({
      where: { id: "project_1" },
      select: { team: { select: { organizationId: true } } },
    });
  });

  /** @scenario "Project-rooted startup migrations prove completion for projects" */
  it("checks project-scoped startup completion instead of enumerating organizations", async () => {
    const { database, projectFindMany, organizationFindMany } = stubDatabase({
      enrollments: [],
      memberships: {},
    });
    const adapter = SystemMigrationPassService.create({
      repositories: passRepositoriesOver(database),
      isSaaS: () => true,
      tenantAxis: "project",
      migrations: () => [
        migrationOf({
          name: "startup-project",
          enrolledAutomatically: true,
          executionMode: "startup",
        }),
      ],
      userMigrations: () => [],
      newbornSweep: async () => {},
    });

    await adapter.runStartup({ maxPasses: 1, pollDelayMs: 0 });

    expect(projectFindMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: "asc" },
      select: { id: true },
      take: 100,
    });
    expect(organizationFindMany).not.toHaveBeenCalled();
  });
});
