/**
 * The enrollment wiring in runtime.ts, on a CLOUD installation: the pass's
 * cohort is read from `SystemMigrationEnrollment` fresh at the start of every
 * pass, the cutover's own stage is a separate per-call read, and the retired
 * environment knobs change nothing except a warning. Storage and the
 * event-sourcing stack are stubbed - the composition is what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const enrollmentFindMany = vi.fn();
  const enrollmentFindUnique = vi.fn();
  const warnings: Array<[string, unknown, unknown]> = [];
  const organizationUserFindMany = vi.fn().mockResolvedValue([]);
  return {
    enrollmentFindMany,
    enrollmentFindUnique,
    organizationUserFindMany,
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
      },
    },
  };
});

vi.mock("~/server/db", () => ({ prisma: stubs.prisma }));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: true } }));
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));
vi.mock("../../app", () => ({ tryGetApp: () => null }));
vi.mock("../../authz/epoch", () => ({
  bumpAuthzEpoch: vi.fn(),
  getAuthzEpoch: vi.fn(),
}));
vi.mock("../../authz/ledger", () => ({ authzGrantsCommands: vi.fn() }));
vi.mock("../../authz/runtime", () => ({ authzCollector: {} }));
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
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

import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../identity/identifier-write-gate";
import {
  migrationPassCohort,
  runSystemMigrationPass,
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
      expect(firstPass({ tenantId: "org_acme", migrationName: backfill })).toBe(
        false,
      );

      // The operator enrolls (and later withdraws) with no restart anywhere.
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme", migrationName: backfill },
      ]);
      const secondPass = await migrationPassCohort();
      expect(
        secondPass({ tenantId: "org_acme", migrationName: backfill }),
      ).toBe(true);
      expect(
        secondPass({ tenantId: "org_globex", migrationName: backfill }),
      ).toBe(false);

      stubs.enrollmentFindMany.mockResolvedValueOnce([]);
      const thirdPass = await migrationPassCohort();
      expect(thirdPass({ tenantId: "org_acme", migrationName: backfill })).toBe(
        false,
      );

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
      stubs.organizationUserFindMany.mockImplementationOnce(
        async ({ where }: { where: { organizationId: { in: string[] } } }) =>
          where.organizationId.in.includes("org_acme")
            ? [{ userId: "user_sam" }, { userId: "user_ann" }]
            : [],
      );

      const cohort = await userMigrationPassCohort();

      expect(cohort({ tenantId: "user_sam", migrationName: backfill })).toBe(
        true,
      );
      expect(cohort({ tenantId: "user_ann", migrationName: backfill })).toBe(
        true,
      );
      // Only a member of globex, which nobody enrolled.
      expect(cohort({ tenantId: "user_gil", migrationName: backfill })).toBe(
        false,
      );
      // Outside every organization: nothing enrolls them on cloud.
      expect(cohort({ tenantId: "user_solo", migrationName: backfill })).toBe(
        false,
      );
      // Membership was read for the enrolled organizations only.
      expect(stubs.organizationUserFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: { in: ["org_acme"] } },
        }),
      );
    });
  });

  describe("when nothing is enrolled", () => {
    it("reads no membership and admits nobody", async () => {
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);

      const cohort = await userMigrationPassCohort();

      expect(
        cohort({
          tenantId: "user_sam",
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        }),
      ).toBe(false);
      expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
    });
  });
});
