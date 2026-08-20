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
  return {
    enrollmentFindMany,
    enrollmentFindUnique,
    warnings,
    prisma: {
      systemMigrationEnrollment: {
        findMany: enrollmentFindMany,
        findUnique: enrollmentFindUnique,
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

import {
  cutoverEnrollmentCohort,
  migrationPassCohort,
  runSystemMigrationPass,
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
      stubs.enrollmentFindMany.mockResolvedValueOnce([]);
      const firstPass = await migrationPassCohort();
      expect(firstPass("org_acme")).toBe(false);

      // The operator enrolls (and later withdraws) with no restart anywhere.
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme" },
      ]);
      const secondPass = await migrationPassCohort();
      expect(secondPass("org_acme")).toBe(true);
      expect(secondPass("org_globex")).toBe(false);

      stubs.enrollmentFindMany.mockResolvedValueOnce([]);
      const thirdPass = await migrationPassCohort();
      expect(thirdPass("org_acme")).toBe(false);

      expect(stubs.enrollmentFindMany).toHaveBeenCalledTimes(3);
      expect(stubs.enrollmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stage: "migrations" } }),
      );
    });
  });

  describe("when an organization is enrolled for migration but not for cutover", () => {
    /** @scenario "Migration and cutover enrollment pace independently" */
    it("admits it to the pass while the cutover stage still refuses it", async () => {
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme" },
      ]);
      stubs.enrollmentFindUnique.mockResolvedValueOnce(null);

      const cohort = await migrationPassCohort();
      expect(cohort("org_acme")).toBe(true);
      await expect(cutoverEnrollmentCohort("org_acme")).resolves.toBe(false);

      expect(stubs.enrollmentFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_stage: {
              organizationId: "org_acme",
              stage: "cutover",
            },
          },
        }),
      );
    });

    it("admits the cutover once its own stage is enrolled", async () => {
      stubs.enrollmentFindUnique.mockResolvedValueOnce({
        organizationId: "org_acme",
      });
      await expect(cutoverEnrollmentCohort("org_acme")).resolves.toBe(true);
    });
  });

  describe("when a deployment still sets the retired environment variables", () => {
    /** @scenario "Enrollment alone decides which organizations migrate" */
    it("warns once per variable per pass and lets enrollment decide anyway", async () => {
      process.env.SYSTEM_MIGRATIONS_COHORT = "all";
      process.env.AUTHZ_CUTOVER_COHORT = "none";
      stubs.enrollmentFindMany.mockResolvedValue([]);
      try {
        // The pass stands down at the lease (no Redis here), but the warning
        // and the enrollment read both happen before that.
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
      expect(stubs.enrollmentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { stage: "migrations" } }),
      );
    });
  });
});
