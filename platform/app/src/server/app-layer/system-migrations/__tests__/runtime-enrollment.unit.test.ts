/** Cloud cohort wiring with storage and event sourcing stubbed. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const enrollmentFindMany = vi.fn();
  const enrollmentFindUnique = vi.fn();
  const warnings: Array<[string, unknown, unknown]> = [];
  const organizationUserFindMany = vi.fn().mockResolvedValue([]);
  const organizationUserFindFirst = vi.fn().mockResolvedValue(null);
  const userFindUnique = vi.fn().mockResolvedValue(null);
  const userFindMany = vi.fn().mockResolvedValue([]);
  const organizationFindMany = vi.fn().mockResolvedValue([]);
  const secretHealQueryRaw = vi.fn().mockResolvedValue([]);
  return {
    secretHealQueryRaw,
    enrollmentFindMany,
    enrollmentFindUnique,
    organizationUserFindMany,
    organizationUserFindFirst,
    userFindUnique,
    userFindMany,
    organizationFindMany,
    warnings,
    prisma: {
      systemMigrationEnrollment: {
        findMany: enrollmentFindMany,
        findUnique: enrollmentFindUnique,
      },
      // The pass pages tenants before claiming any (per-organization
      // claims); an empty page ends it without touching Redis.
      organization: {
        findMany: organizationFindMany,
      },
      // The user-rooted leg pages users the same way; the cohort reads a
      // candidate's memberships as a relation off their own row.
      user: {
        findMany: userFindMany,
        findUnique: userFindUnique,
      },
      organizationUser: {
        findMany: organizationUserFindMany,
        findFirst: organizationUserFindFirst,
      },
      // The secret heal declares its own candidate tenants — the users whose
      // legacy secrets could have drifted — and asks for them in raw SQL,
      // because the predicate compares a column against a column on a
      // related row. None drifted here; this suite is about which cohort a
      // tenant lands in, not about what the heal then finds.
      $queryRaw: secretHealQueryRaw,
    },
  };
});

/** Answers the cohort's per-user membership probes from a plain map. */
function stubMemberships(memberships: Record<string, string[]>): void {
  stubs.userFindUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) =>
      where.id in memberships
        ? {
            orgMemberships: memberships[where.id]!.map((organizationId) => ({
              organizationId,
            })),
          }
        : null,
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

import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../authz/migration-name";
import {
  IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
  IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
} from "../../identity/migration-name";
import { IDENTITY_SECRET_HEAL_MIGRATION_NAME } from "../../identity/secret-heal.migration";
import { RedisMigrationLeaseRepository } from "../repositories/migration-lease.redis.repository";
import {
  migrationPassCohort,
  registeredMigrations,
  runSystemMigrationPass,
  runSystemMigrationTargetedPass,
  runSystemMigrationUserPass,
  userMigrationPassCohort,
} from "../runtime";

// The production client refuses tenancy-unbounded queries (guardOrganizationId
// in db.ts); route every stubbed delegate through the real guard so a query
// shape that throws on cloud throws here too. The cohort probe once read
// OrganizationUser by userId alone — a shape the guard rejects — and this
// suite could not see that while the stubs bypassed the guard.
for (const [delegateName, delegate] of Object.entries(stubs.prisma)) {
  // `$queryRaw` and friends are client methods, not model delegates — the
  // guard keys off a model name and there is none to give it.
  if (delegateName.startsWith("$")) continue;
  const model = delegateName.charAt(0).toUpperCase() + delegateName.slice(1);
  for (const [action, fn] of Object.entries(delegate)) {
    (delegate as Record<string, unknown>)[action] = (args: unknown) =>
      guardOrganizationId({ model, action, args }, (params) =>
        (fn as (a: unknown) => Promise<unknown>)(params.args),
      );
  }
}

describe("the PR1 migration registry", () => {
  /** @scenario "The D04 connection grandfather migration is declared in the shared registry" */
  it("declares D04 beside the authorization engine, for every organization-rooted path", () => {
    const migrationNames = registeredMigrations().map(
      (migration) => migration.name,
    );

    expect(migrationNames).toEqual([
      AUTHZ_ENGINE_MIGRATION_NAME,
      IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
    ]);
  });
});

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

describe("given a full pass over both legs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when one user migration declares its own candidate tenants", () => {
    /** @scenario "A migration that declares its own tenants keeps them" */
    it("visits the declared tenants for it and only the tenants with work left for the rest", async () => {
      stubs.enrollmentFindMany.mockResolvedValue([]);

      await runSystemMigrationPass();

      const queries = stubs.secretHealQueryRaw.mock.calls.map(
        ([strings, ...values]: [TemplateStringsArray, ...unknown[]]) => ({
          sql: strings.join(" "),
          values,
        }),
      );
      // The heal's own source asks about drifted credentials and nothing
      // else: narrowing it by migration state would empty it, because the
      // heal never finalizes anyone.
      const declared = queries.filter((query) =>
        query.sql.includes("AccountCredential"),
      );
      const narrowed = queries.filter((query) =>
        query.sql.includes("SystemMigrationTenantState"),
      );
      expect(declared).toHaveLength(1);
      // One narrowed walk per leg: organizations, then the users the
      // backfill bucket is driven over.
      expect(narrowed).toHaveLength(2);

      const askedAbout = narrowed.flatMap((query) =>
        query.values.filter(Array.isArray).flat(),
      );
      expect(askedAbout).toContain(AUTHZ_ENGINE_MIGRATION_NAME);
      expect(askedAbout).toContain(
        IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
      );
      expect(askedAbout).toContain(IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME);
      expect(askedAbout).not.toContain(IDENTITY_SECRET_HEAL_MIGRATION_NAME);

      // The unnarrowed table walks are what the pass used to do.
      expect(stubs.organizationFindMany).not.toHaveBeenCalled();
      expect(stubs.userFindMany).not.toHaveBeenCalled();
    });
  });
});

describe("userMigrationPassCohort on cloud", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** @scenario "Identifier backfill automatically includes every user" */
  it("admits every user to the automatic identifier backfill", async () => {
    stubs.enrollmentFindMany.mockResolvedValueOnce([]);

    const cohort = await userMigrationPassCohort();
    const migrationName = IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME;

    await expect(cohort({ tenantId: "user_sam", migrationName })).resolves.toBe(
      true,
    );
    await expect(
      cohort({ tenantId: "user_without_an_org", migrationName }),
    ).resolves.toBe(true);
    expect(stubs.userFindUnique).not.toHaveBeenCalled();
  });

  describe("when a user migration is still paced by enrollment", () => {
    // Regression for langwatch/langwatch#7709: keep the enrolled set out of
    // each membership query, regardless of its size.
    it("checks only the candidate user's memberships", async () => {
      const migrationName = "paced-user-migration";
      const enrolled = Array.from({ length: 500 }, (_, i) => ({
        organizationId: `org_${i}`,
        migrationName,
      }));
      stubs.enrollmentFindMany.mockResolvedValueOnce(enrolled);
      stubMemberships({
        user_multi: ["org_unenrolled", "org_7"],
        user_out: ["org_unenrolled"],
      });

      const cohort = await userMigrationPassCohort();

      await expect(
        cohort({ tenantId: "user_multi", migrationName }),
      ).resolves.toBe(true);
      await expect(
        cohort({ tenantId: "user_out", migrationName }),
      ).resolves.toBe(false);
      await expect(
        cohort({ tenantId: "user_without_an_org", migrationName }),
      ).resolves.toBe(false);

      for (const call of stubs.userFindUnique.mock.calls) {
        expect(call[0].where).toEqual({ id: expect.any(String) });
      }
      expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
      expect(stubs.organizationUserFindFirst).not.toHaveBeenCalled();
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

describe("runSystemMigrationUserPass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "User-targeted automatic adoption preserves per-user scope and leases" */
  it("runs for the arriving user without enrollment", async () => {
    const acquire = vi
      .spyOn(RedisMigrationLeaseRepository.prototype, "acquire")
      .mockResolvedValue(true);
    stubs.enrollmentFindMany.mockResolvedValueOnce([]);

    const summary = await runSystemMigrationUserPass({
      userId: "arriving_user",
      migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
    });

    expect(summary).toMatchObject({
      tenantsSeen: 1,
      skipped: 0,
      finalized: 0,
      parked: 1,
      advanced: 0,
    });
    expect(acquire).toHaveBeenCalledOnce();
    expect(stubs.userFindUnique).not.toHaveBeenCalled();
    expect(stubs.userFindMany).not.toHaveBeenCalled();
    expect(stubs.organizationFindMany).not.toHaveBeenCalled();
    expect(stubs.organizationUserFindMany).not.toHaveBeenCalled();
  });

  /** @scenario "User-targeted automatic adoption preserves per-user scope and leases" */
  it("does not start adoption while another pass holds the user lease", async () => {
    const acquire = vi
      .spyOn(RedisMigrationLeaseRepository.prototype, "acquire")
      .mockResolvedValue(false);
    stubs.enrollmentFindMany.mockResolvedValueOnce([]);

    const summary = await runSystemMigrationUserPass({
      userId: "arriving_user",
      migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
    });

    expect(summary).toMatchObject({
      tenantsSeen: 1,
      claimed: 1,
      finalized: 0,
      advanced: 0,
    });
    expect(acquire).toHaveBeenCalledOnce();
    expect(stubs.userFindUnique).not.toHaveBeenCalled();
    expect(stubs.userFindMany).not.toHaveBeenCalled();
  });
});
