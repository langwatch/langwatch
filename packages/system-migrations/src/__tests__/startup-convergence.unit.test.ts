import { describe, expect, it } from "vitest";
import {
  runSystemMigrationsAtStartup,
  SystemMigrationStartupIncompleteError,
} from "../convergence.ts";
import type { SystemMigrationStateRepository } from "../state.repository.ts";
import type { TenantSource } from "../tenant-source.ts";
import type { TenantMigrationRecord } from "../types.ts";
import type { SystemMigration } from "../system-migration.ts";

const migration = {
  name: "m1",
  title: "Migration",
  description: "Test migration",
  requiresOperatorConfirmation: false,
  runsAutomaticallyOnSelfHosted: true,
  enrolledAutomatically: true,
  migrateTenant: async () => ({ status: "finalized", report: {} }),
} satisfies SystemMigration;
const tenants: TenantSource = {
  findTenantIdsAfter: async ({ cursor }) => (cursor ? [] : ["org-1"]),
};

function state(initial: TenantMigrationRecord | null): SystemMigrationStateRepository {
  let record = initial;
  return {
    tryFindRecord: async () => record,
    upsertRecord: async (next) => {
      record = next;
    },
    upsertRecordUnlessRolledBack: async (next) => {
      record = next;
      return true;
    },
    hasFinalizedTenant: async () => record?.status === "finalized",
  };
}

describe("runSystemMigrationsAtStartup", () => {
  it("waits for durable finalization", async () => {
    const repository = state(null);
    let passes = 0;
    await runSystemMigrationsAtStartup({
      state: repository,
      tenants,
      migrations: [migration],
      cohort: async () => true,
      maxPasses: 2,
      pollDelayMs: 0,
      runPass: async () => {
        passes += 1;
        await repository.upsertRecord({
          migrationName: "m1",
          tenantId: "org-1",
          status: "finalized",
          report: {},
        });
        return {
          tenantsSeen: 1,
          finalized: 1,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
          advanced: 1,
        };
      },
    });
    expect(passes).toBe(1);
  });

  it.each(["parked", "rolled_back"] as const)("rejects %s", async (status) => {
    await expect(
      runSystemMigrationsAtStartup({
        state: state({ migrationName: "m1", tenantId: "org-1", status, report: {} }),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        maxPasses: 1,
        pollDelayMs: 0,
        runPass: async () => ({
          tenantsSeen: 1,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
          advanced: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(SystemMigrationStartupIncompleteError);
  });

  it("rejects invalid retry bounds", async () => {
    await expect(
      runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        maxPasses: 0,
        runPass: async () => ({
          tenantsSeen: 0,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 0,
          advanced: 0,
        }),
      }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects no progress after the bounded polls", async () => {
    await expect(
      runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        maxPasses: 2,
        pollDelayMs: 0,
        runPass: async () => ({
          tenantsSeen: 1,
          finalized: 0,
          held: 1,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 0,
          advanced: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(SystemMigrationStartupIncompleteError);
  });

  it("does not report readiness after a mid-pass abort", async () => {
    const controller = new AbortController();
    await expect(
      runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        signal: controller.signal,
        maxPasses: 1,
        runPass: async () => {
          controller.abort();
          return {
            tenantsSeen: 0,
            finalized: 0,
            held: 0,
            parked: 0,
            skipped: 0,
            alreadyFinalized: 0,
            alreadyRolledBack: 0,
            claimed: 0,
            advanced: 0,
          };
        },
      }),
    ).rejects.toBeInstanceOf(SystemMigrationStartupIncompleteError);
  });

  it("preserves a failed pass cause", async () => {
    const cause = new Error("database unavailable");
    let failure: unknown;
    try {
      await runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        runPass: async () => {
          throw cause;
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemMigrationStartupIncompleteError);
    if (failure instanceof SystemMigrationStartupIncompleteError) expect(failure.cause).toBe(cause);
  });

  it("preserves the abort reason", async () => {
    const controller = new AbortController();
    const reason = new Error("shutdown");
    controller.abort(reason);
    let failure: unknown;
    try {
      await runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        signal: controller.signal,
        runPass: async () => ({
          tenantsSeen: 0,
          finalized: 0,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 0,
          advanced: 0,
        }),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemMigrationStartupIncompleteError);
    if (failure instanceof SystemMigrationStartupIncompleteError)
      expect(failure.cause).toBe(reason);
  });

  it("does not trust a finalized pass summary without durable state", async () => {
    await expect(
      runSystemMigrationsAtStartup({
        state: state(null),
        tenants,
        migrations: [migration],
        cohort: async () => true,
        maxPasses: 1,
        pollDelayMs: 0,
        runPass: async () => ({
          tenantsSeen: 1,
          finalized: 1,
          held: 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
          advanced: 1,
        }),
      }),
    ).rejects.toThrow("m1/org-1");
  });

  it("re-reads a remote claim until its durable finalization appears", async () => {
    const repository = state(null);
    let passes = 0;
    await runSystemMigrationsAtStartup({
      state: repository,
      tenants,
      migrations: [migration],
      cohort: async () => true,
      pollDelayMs: 0,
      maxPasses: 2,
      runPass: async () => {
        passes += 1;
        if (passes === 2)
          await repository.upsertRecord({
            migrationName: "m1",
            tenantId: "org-1",
            status: "finalized",
            report: {},
          });
        return {
          tenantsSeen: 1,
          finalized: passes === 2 ? 1 : 0,
          held: passes === 1 ? 1 : 0,
          parked: 0,
          skipped: 0,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
          advanced: 0,
        };
      },
    });
    expect(passes).toBe(2);
  });

  it("ignores excluded tenants but blocks included ones", async () => {
    const excludedAwareTenants: TenantSource = {
      findTenantIdsAfter: async ({ cursor }) => (cursor ? [] : ["excluded", "included"]),
    };
    await expect(
      runSystemMigrationsAtStartup({
        state: state(null),
        tenants: excludedAwareTenants,
        migrations: [migration],
        cohort: async ({ tenantId }) => tenantId === "included",
        maxPasses: 1,
        pollDelayMs: 0,
        runPass: async () => ({
          tenantsSeen: 2,
          finalized: 0,
          held: 1,
          parked: 0,
          skipped: 1,
          alreadyFinalized: 0,
          alreadyRolledBack: 0,
          claimed: 1,
          advanced: 0,
        }),
      }),
    ).rejects.toThrow("m1/included");
  });
});
