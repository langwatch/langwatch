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
  stubs.organizationUserFindMany.mockImplementation(
    async ({ where }: { where: { userId: string } }) =>
      (memberships[where.userId] ?? []).map((organizationId) => ({
        organizationId,
      })),
  );
}

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
vi.mock("../../../clickhouse/clickhouseClient", () => ({
  getPrivateClickHouseUrls: () => new Map([["org_private", "http://private"]]),
}));
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

import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../authz/migration-name";
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

      await expect(
        cohort({ tenantId: "user_sam", migrationName: backfill }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_ann", migrationName: backfill }),
      ).resolves.toBe(true);
      // Only a member of globex, which nobody enrolled.
      await expect(
        cohort({ tenantId: "user_gil", migrationName: backfill }),
      ).resolves.toBe(false);
      // Outside every organization: nothing enrolls them on cloud.
      await expect(
        cohort({ tenantId: "user_solo", migrationName: backfill }),
      ).resolves.toBe(false);
      // Membership is probed by the user's own memberships alone — the
      // enrolled set stays in memory and never rides along as an IN list
      // (whose planning cost scales with every enrolled organization).
      expect(stubs.organizationUserFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user_sam" },
        }),
      );
      expect(stubs.organizationUserFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("when many organizations are enrolled and the user belongs to a few", () => {
    // Regression for langwatch/langwatch#7709 — the cohort probe must not inline the enrolled set.
    it("answers from the user's memberships without shipping the enrolled set to the database", async () => {
      const backfill = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
      const enrolled = Array.from({ length: 500 }, (_, i) => ({
        organizationId: `org_${i}`,
        migrationName: backfill,
      }));
      stubs.enrollmentFindMany.mockResolvedValueOnce(enrolled);
      stubMemberships({
        user_multi: ["org_unenrolled", "org_7"],
        user_out: ["org_unenrolled"],
      });

      const cohort = await userMigrationPassCohort();

      await expect(
        cohort({ tenantId: "user_multi", migrationName: backfill }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_out", migrationName: backfill }),
      ).resolves.toBe(false);
      // The regression #7709 guards against: one parameter per probe, no
      // organizationId filter, regardless of how many organizations are
      // enrolled.
      for (const call of stubs.organizationUserFindMany.mock.calls) {
        expect(call[0].where).toEqual({ userId: expect.any(String) });
      }
      expect(stubs.organizationUserFindFirst).not.toHaveBeenCalled();
    });
  });

  describe("when an enrolled organization's member also belongs to a private-dataplane organization", () => {
    // A user tenant resolves now — to the shared instance, whoever they
    // belong to — so there is nothing left for this to protect against, and
    // excluding these people would strand exactly them on the legacy path.
    // Their enrolment reads like anybody else's.
    it("admits that member, and admits them through their private-dataplane organization too", async () => {
      const backfill = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;
      stubs.enrollmentFindMany.mockResolvedValueOnce([
        { organizationId: "org_acme", migrationName: backfill },
        { organizationId: "org_private", migrationName: backfill },
      ]);
      stubMemberships({
        user_sam: ["org_acme"],
        user_both: ["org_private", "org_acme"],
        user_private_only: ["org_private"],
      });

      const cohort = await userMigrationPassCohort();

      await expect(
        cohort({ tenantId: "user_sam", migrationName: backfill }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_both", migrationName: backfill }),
      ).resolves.toBe(true);
      // The enrolled private-dataplane organization is a real enrolment, not
      // a filtered-out one: somebody who reaches the migration only through
      // it is in the cohort.
      await expect(
        cohort({ tenantId: "user_private_only", migrationName: backfill }),
      ).resolves.toBe(true);
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
    // This used to refuse outright, because a member's identity events could
    // not be placed anywhere. They can be now — on the shared instance, like
    // every other user — so the operator's targeted lever reaches these
    // organizations like any other, and the run gets as far as reading
    // members rather than being turned away at the door.
    it("runs rather than refusing, and reads the organization's members", async () => {
      await expect(
        runSystemMigrationTargetedPass({
          organizationId: "org_private",
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        }),
      ).resolves.toBeDefined();
      expect(stubs.organizationUserFindMany).toHaveBeenCalled();
    });
  });
});
