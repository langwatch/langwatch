/**
 * @vitest-environment node
 * The boot chain's convergence loop over the real runner: what a held tenant and a parked
 * tenant cost the start, driven through fakes of the ledger and the lease.
 * Spec: specs/migration/system-migrations-runner.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { driveSystemMigrationsToConvergence } from "../convergence.ts";
import type { MigrationLeaseRepository } from "../lease.repository.ts";
import { SystemMigrationRunnerService } from "../runner.service.ts";
import {
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
} from "../state.repository.ts";
import type { SystemMigration } from "../system-migration.ts";
import type { TenantMigrationOutcome, TenantMigrationRecord } from "../types.ts";

class FakeState implements SystemMigrationStateRepository {
  records = new Map<string, TenantMigrationRecord>();

  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) => record.migrationName === migrationName && record.status === "finalized",
    );
  }

  async getRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord> {
    const record = this.records.get(`${migrationName}::${tenantId}`);
    if (!record) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return record;
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.records.set(`${record.migrationName}::${record.tenantId}`, record);
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    await this.upsertRecord(record);
    return true;
  }
}

const freeLease: MigrationLeaseRepository = {
  acquire: async () => true,
  renew: async () => true,
  release: async () => {},
};

function migrationOf(migrateTenant: SystemMigration["migrateTenant"]): SystemMigration {
  return {
    name: "m1",
    title: "m1",
    description: "m1",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: false,
    migrateTenant,
  };
}

function bootChain({
  state,
  tenantIds,
  migrateTenant,
}: {
  state: FakeState;
  tenantIds: string[];
  migrateTenant: SystemMigration["migrateTenant"];
}): Promise<void> {
  const runner = new SystemMigrationRunnerService({
    state,
    lease: freeLease,
    tenants: {
      async findTenantIdsAfter({ cursor }) {
        return cursor === null ? tenantIds : [];
      },
    },
    cohort: () => true,
    migrations: [migrationOf(migrateTenant)],
  });
  return driveSystemMigrationsToConvergence({
    signal: new AbortController().signal,
    runPass: ({ signal }) => runner.runPass({ signal }),
  });
}

async function settle({ run }: { run: Promise<void> }): Promise<void> {
  await vi.advanceTimersByTimeAsync(120_000);
  await run;
}

describe("the boot chain's convergence loop", () => {
  let state: FakeState;

  beforeEach(() => {
    vi.useFakeTimers();
    state = new FakeState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a migration that remains held after its pass, with nothing advancing", () => {
    /** @scenario "A held migration stays on the legacy path without preventing startup" */
    it("re-proves it once, ends the run, and leaves its gate closed", async () => {
      const migrate = vi.fn(async (): Promise<TenantMigrationOutcome> => ({
        status: "migrated",
        report: { outstanding: ["still disagreeing"] },
      }));

      await settle({ run: bootChain({ state, tenantIds: ["acme"], migrateTenant: migrate }) });

      // Pass one adopts it (pending to migrated, progress); pass two re-proves it into the same
      // state, which counts for nothing, so the run ends there rather than looping to the cap.
      expect(migrate).toHaveBeenCalledTimes(2);
      const held = await state.getRecord({ migrationName: "m1", tenantId: "acme" });
      expect(held.status).toBe("migrated");
      expect(held.report).toEqual({ outstanding: ["still disagreeing"] });
    });
  });

  describe("given one tenant's migration parks on an error", () => {
    /** @scenario "One tenant's parked migration does not stop the fleet starting" */
    it("completes the run, leaves that tenant parked with its error, and finalizes the rest", async () => {
      const migrate = vi.fn(async ({ tenantId }: { tenantId: string }) => {
        if (tenantId === "acme") throw new Error("storage unavailable");
        return { status: "finalized" } as const;
      });

      // A rejection here is the preflight refusing to finish: the run must resolve.
      await settle({
        run: bootChain({ state, tenantIds: ["acme", "globex"], migrateTenant: migrate }),
      });

      const parked = await state.getRecord({ migrationName: "m1", tenantId: "acme" });
      expect(parked.status).toBe("parked");
      expect(parked.report).toMatchObject({ kind: "error", message: "storage unavailable" });
      const healthy = await state.getRecord({ migrationName: "m1", tenantId: "globex" });
      expect(healthy.status).toBe("finalized");
      // Parked the same way twice counts for nothing, so the run ended on its own.
      expect(migrate).toHaveBeenCalledTimes(3);
    });
  });
});
