/**
 * @vitest-environment node
 *
 * The address-lock reap runs on the migration pass's cadence (ADR-116 §6),
 * which is what makes it a companion to the lock rather than a class someone
 * remembered to write. `IdentityGuards` claims a lock before the fact is
 * stated, so a ceremony that claims and then fails leaves an address nobody
 * could ever take again.
 *
 * It is a LEG of the pass rather than a registered migration, and the reason
 * is the thing this suite pins: what the reap hunts has no tenant a runner
 * could visit. The user tenant source enumerates `User` rows, and an orphaned
 * lock is precisely a claim no live identifier backs — so a per-tenant
 * migration would never reach one.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => {
  const runPass = vi.fn(async () => ({ locksReaped: 0 }));
  return {
    runPass,
    prisma: {
      systemMigrationEnrollment: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      organization: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      organizationUser: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      systemMigrationTenantState: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("~/server/db", () => ({ prisma: stubs.prisma }));
vi.mock("~/env.mjs", () => ({ env: { IS_SAAS: true } }));
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));
vi.mock("../../authz/engine-gate", () => ({
  forgetOrganizationEngineGate: vi.fn(),
}));
vi.mock("../../authz/epoch", () => ({
  bumpAuthzEpoch: vi.fn(),
  bumpGlobalAuthzEpoch: vi.fn(),
}));
vi.mock("../../authz/ledger", () => ({ authzGrantsCommands: vi.fn() }));
vi.mock("../../authz/runtime", () => ({ authzCollector: {} }));
vi.mock("../../../clickhouse/clickhouseClient", () => ({
  getPrivateClickHouseUrls: () => new Map(),
}));
vi.mock("../../identity/runtime", () => ({
  identifierBackfillMigration: () => ({
    name: "identity-d01-identifier-backfill",
    title: "backfill",
    description: "backfill",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically: false,
    migrateTenant: vi.fn(),
  }),
  identitySecretHealMigration: () => ({
    name: "identity-d01-secret-heal",
    title: "heal",
    description: "heal",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically: false,
    migrateTenant: vi.fn(),
  }),
  connectionGrandfatherMigration: () => ({
    name: "identity-d04-connection-grandfather",
    title: "grandfather",
    description: "grandfather",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: false,
    enrolledAutomatically: false,
    migrateTenant: vi.fn(),
  }),
  identityAddressLockReaper: () => ({ runPass: stubs.runPass }),
}));

import { runSystemMigrationPass } from "../runtime";

describe("the system migration pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubs.runPass.mockResolvedValue({ locksReaped: 0 });
  });

  describe("when a pass runs", () => {
    /** @scenario "The address-lock reap runs on every migration pass" */
    it("reaps orphaned address locks alongside the user-rooted migrations", async () => {
      await runSystemMigrationPass({ redis: null });

      expect(stubs.runPass).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the reap itself fails", () => {
    /** @scenario "The address-lock reap runs on every migration pass" */
    it("still reports the pass, because the reap cleans rows the pass did not write", async () => {
      stubs.runPass.mockRejectedValueOnce(new Error("database unavailable"));

      const summary = await runSystemMigrationPass({ redis: null });

      expect(summary).toMatchObject({ tenantsSeen: 0 });
    });
  });
});
