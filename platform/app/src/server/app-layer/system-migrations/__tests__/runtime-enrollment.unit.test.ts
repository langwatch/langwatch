/**
 * The cohort wiring in runtime.ts, on a CLOUD installation: a migration
 * enrollment still paces reads `SystemMigrationEnrollment` fresh at the start
 * of every pass, a migration declaring `enrolledAutomatically` skips that
 * read and admits every organization, and the retired environment knobs
 * change nothing except a warning. Storage and the event-sourcing stack are
 * stubbed - the composition is what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const enrollmentFindMany = vi.fn();
  const enrollmentFindUnique = vi.fn();
  const warnings: Array<[string, unknown, unknown]> = [];
  const organizationUserFindMany = vi.fn().mockResolvedValue([]);
  const organizationUserFindFirst = vi.fn().mockResolvedValue(null);
  return {
    enrollmentFindMany,
    enrollmentFindUnique,
    organizationUserFindMany,
    organizationUserFindFirst,
    warnings,
    prisma: {
      systemMigrationEnrollment: {
        findMany: enrollmentFindMany,
        findUnique: enrollmentFindUnique,
      },
      // The pass pages tenants before claiming any (per-organization
      // claims); an empty page ends it without touching Redis.
      organization: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      // The user-rooted leg pages users the same way.
      user: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      organizationUser: {
        findMany: organizationUserFindMany,
        findFirst: organizationUserFindFirst,
      },
    },
  };
});

/** Answers the cohort's per-user membership probes from a plain map. */
function stubMemberships(memberships: Record<string, string[]>): void {
  stubs.organizationUserFindFirst.mockImplementation(
    async ({ where }: { where: { userId: string; organizationId: { in: string[] } } }) => {
      const organizations = memberships[where.userId] ?? [];
      return organizations.some((organizationId) =>
        where.organizationId.in.includes(organizationId),
      )
        ? { userId: where.userId }
        : null;
    },
  );
}

vi.mock("~/server/db", () => ({ prisma: stubs.prisma }));
// The private-dataplane routing table. Several scenarios below name
// "org_private" and one of them says outright that it is "mocked above" — so
// this is the mock they were written against, and its absence is why they
// failed. Only the KEYS are ever read: the cohort asks which organizations run
// their own instance, never queries them. The real accessor refuses to answer
// at all until a runtime has been composed, which is right for a process and
// wrong for a unit test of the cohort wiring.
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getPrivateClickHouseUrls: () =>
    new Map<string, string>([["org_private", "https://org-private.clickhouse.invalid"]]),
}));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: true } }));
vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));
// The authorization-engine migration reaches the cohort through the App
// (`registeredMigrations` reads `tryGetApp()?.authzMigration`), so a process
// answering null registers nothing and every assertion about a migration that
// "declares itself automatic" would read false against an empty registry. The
// declaration itself is pinned where it is written -
// packages/features/authz/server/src/migrations/__tests__/legacy-import.authz-grant.migration.unit.test.ts
// asserts `enrolledAutomatically` is true - so what this suite owns is only
// what the COHORT does with such a declaration.
vi.mock("../../app", () => ({
  tryGetApp: () => ({
    authzMigration: {
      name: AUTHZ_ENGINE_MIGRATION_NAME,
      title: "Authorization engine",
      description: "Moves an organization onto the authorization engine.",
      requiresOperatorConfirmation: true,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
      migrateTenant: async () => ({ status: "migrated" as const, report: {} }),
    },
  }),
}));
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = {
        info: vi.fn(),
        warn: (details: unknown, message: unknown) => {
          stubs.warnings.push([name, details, message]);
        },
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => logger,
      };
      return logger;
    },
  };
});

import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../identity/migration-name";
import {
  migrationPassCohort,
  runSystemMigrationPass,
  runSystemMigrationTargetedPass,
  userMigrationPassCohort,
} from "../runtime";

describe("migrationPassCohort on cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.warnings.length = 0;
    delete process.env.SYSTEM_MIGRATIONS_COHORT;
    delete process.env.AUTHZ_CUTOVER_COHORT;
  });

  describe("when an organization is enrolled between two passes", () => {
    /** @scenario "Enrolling an organization takes effect on the next pass" */
    it("reads enrollment fresh per pass, so the next pass picks the change up", async () => {
      const backfill = "authz-team-user-backfill";
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);
      const firstPass = await migrationPassCohort();
      expect(firstPass({ tenantId: "org_acme", migrationName: backfill })).toBe(false);

      // The operator enrolls (and later withdraws) with no restart anywhere.
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme", migrationName: backfill },
      ]);
      const secondPass = await migrationPassCohort();
      expect(secondPass({ tenantId: "org_acme", migrationName: backfill })).toBe(true);
      expect(secondPass({ tenantId: "org_globex", migrationName: backfill })).toBe(false);

      stubs.enrollmentFindMany.mockResolvedValueOnce([]);
      const thirdPass = await migrationPassCohort();
      expect(thirdPass({ tenantId: "org_acme", migrationName: backfill })).toBe(false);

      expect(stubs.enrollmentFindMany).toHaveBeenCalledTimes(3);
    });
  });

  describe("when an organization is enrolled for one migration but not another", () => {
    /** @scenario "Each migration is enrolled separately and paces independently" */
    it("admits exactly the enrolled (organization, migration) pairs", async () => {
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        {
          organizationId: "org_acme",
          migrationName: "authz-team-user-backfill",
        },
      ]);

      const cohort = await migrationPassCohort();
      expect(
        cohort({
          tenantId: "org_acme",
          migrationName: "authz-team-user-backfill",
        }),
      ).toBe(true);
      expect(
        cohort({
          tenantId: "org_acme",
          migrationName: "authz-grants-cutover",
        }),
      ).toBe(false);
    });
  });

  describe("when the migration declares itself enrolled automatically", () => {
    /** @scenario "An organization nobody enrolled migrates for an automatically enrolled migration" */
    it("admits an organization no enrollment row names", async () => {
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);

      const cohort = await migrationPassCohort();

      // The registered authorization-engine migration is the one that
      // declares it; a name nothing registered answers to stays paced.
      expect(
        cohort({
          tenantId: "org_born_later",
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        }),
      ).toBe(true);
      expect(
        cohort({
          tenantId: "org_born_later",
          migrationName: "authz-team-user-backfill",
        }),
      ).toBe(false);
    });

    /** @scenario "An automatic cohort includes a private-dataplane organization" */
    it("admits the organizations the private ClickHouse routing table names", async () => {
      // The routing table is mocked with "org_private" above. An
      // organization-rooted append is placed on that organization's own
      // instance, so there is nothing to keep out of the shared log - and
      // keeping it out would strand that customer on the legacy
      // authorization path forever.
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);

      const cohort = await migrationPassCohort();

      expect(
        cohort({
          tenantId: "org_private",
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
        }),
      ).toBe(true);
    });
  });

  describe("when a deployment still sets the retired environment variables", () => {
    /** @scenario "Enrollment alone decides which organizations migrate" */
    it("warns once per variable per pass and lets enrollment decide anyway", async () => {
      process.env.SYSTEM_MIGRATIONS_COHORT = "all";
      process.env.AUTHZ_CUTOVER_COHORT = "none";
      stubs.enrollmentFindMany.mockResolvedValue([]);
      try {
        // The pass sees no tenants (empty organization page), but the
        // warning and the enrollment read both happen before that.
        await runSystemMigrationPass();
      } finally {
        delete process.env.SYSTEM_MIGRATIONS_COHORT;
        delete process.env.AUTHZ_CUTOVER_COHORT;
      }

      const warned = stubs.warnings
        .map(([, details]) => (details as { variable?: string }).variable)
        .filter(Boolean);
      expect(warned).toContain("SYSTEM_MIGRATIONS_COHORT");
      expect(warned).toContain("AUTHZ_CUTOVER_COHORT");
      // "all" did not widen anything and "none" did not narrow anything:
      // the cohort still came from the enrollment table.
      expect(stubs.enrollmentFindMany).toHaveBeenCalled();
    });
  });
});

describe("userMigrationPassCohort on cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when one organization is enrolled in the identifier backfill and another is not", () => {
    /** @scenario "Organization enrollment is what puts a user in the backfill's cohort" */
    it("admits exactly the enrolled organizations' members; org-less users stay out", async () => {
      const backfill = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme", migrationName: backfill },
      ]);
      stubMemberships({
        user_sam: ["org_acme"],
        user_ann: ["org_acme"],
        user_gil: ["org_globex"],
      });

      const cohort = await userMigrationPassCohort();

      await expect(cohort({ tenantId: "user_sam", migrationName: backfill })).resolves.toBe(true);
      await expect(cohort({ tenantId: "user_ann", migrationName: backfill })).resolves.toBe(true);
      // Only a member of globex, which nobody enrolled.
      await expect(cohort({ tenantId: "user_gil", migrationName: backfill })).resolves.toBe(false);
      // Outside every organization: nothing enrolls them on cloud.
      await expect(cohort({ tenantId: "user_solo", migrationName: backfill })).resolves.toBe(false);
      // Membership is probed per user against the enrolled organizations
      // only - never materialized fleet-wide.
      expect(stubs.organizationUserFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "user_sam",
            organizationId: { in: ["org_acme"] },
          }),
        }),
      );
      expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
    });
  });

  describe("when an enrolled organization's member also belongs to a private-dataplane organization", () => {
    it("keeps that member out, exactly as the organization cohort keeps the organization out", async () => {
      const backfill = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme", migrationName: backfill },
        { organizationId: "org_private", migrationName: backfill },
      ]);
      stubMemberships({
        user_sam: ["org_acme"],
        user_both: ["org_private", "org_acme"],
      });

      const cohort = await userMigrationPassCohort();

      await expect(cohort({ tenantId: "user_sam", migrationName: backfill })).resolves.toBe(true);
      await expect(cohort({ tenantId: "user_both", migrationName: backfill })).resolves.toBe(false);
    });
  });

  describe("when nothing is enrolled", () => {
    it("reads no membership and admits nobody", async () => {
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);

      const cohort = await userMigrationPassCohort();

      await expect(
        cohort({
          tenantId: "user_sam",
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        }),
      ).resolves.toBe(false);
      // An empty enrolled set answers false before any membership probe.
      expect(stubs.organizationUserFindFirst).not.toHaveBeenCalled();
      expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
    });
  });
});

describe("runSystemMigrationTargetedPass for a user-rooted migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the named organization runs a private dataplane", () => {
    it("refuses with migration_not_available_on_installation before touching any member", async () => {
      // The same rule userMigrationPassCohort applies on a full pass: a
      // private-dataplane organization's members' identity events must never
      // land in the shared platform log, and enrollment alone does not
      // enforce that.
      await expect(
        runSystemMigrationTargetedPass({
          organizationId: "org_private",
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        }),
      ).rejects.toMatchObject({
        code: "migration_not_available_on_installation",
      });
      expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
    });
  });
});
