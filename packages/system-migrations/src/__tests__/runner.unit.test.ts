import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MigrationLeaseRepository } from "../lease.repository";
import { SystemMigrationRunnerService } from "../runner.service";
import type { SystemMigrationStateRepository } from "../state.repository";
import type { SystemMigration } from "../system-migration";
import type { TenantSource } from "../tenant-source";
import type { TenantMigrationOutcome, TenantMigrationRecord } from "../types";

class FakeStateRepository implements SystemMigrationStateRepository {
  records = new Map<string, TenantMigrationRecord>();

  private key(migrationName: string, tenantId: string): string {
    return `${migrationName}::${tenantId}`;
  }

  async findRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null> {
    return this.records.get(this.key(migrationName, tenantId)) ?? null;
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.records.set(this.key(record.migrationName, record.tenantId), record);
  }

  async upsertRecordUnlessRolledBack(
    record: TenantMigrationRecord,
  ): Promise<boolean> {
    const key = this.key(record.migrationName, record.tenantId);
    if (this.records.get(key)?.status === "rolled_back") return false;
    this.records.set(key, record);
    return true;
  }
}

class FakeLeaseRepository implements MigrationLeaseRepository {
  private holder: symbol | null = null;
  private readonly self = Symbol("lease-holder");

  static shared(): [FakeLeaseRepository, FakeLeaseRepository] {
    const first = new FakeLeaseRepository();
    const second = new FakeLeaseRepository();
    const state = { holder: null as symbol | null };
    for (const repo of [first, second]) {
      repo.acquire = async () => {
        if (state.holder !== null && state.holder !== repo.self) return false;
        state.holder = repo.self;
        return true;
      };
      repo.renew = async () => state.holder === repo.self;
      repo.release = async () => {
        if (state.holder === repo.self) state.holder = null;
      };
    }
    return [first, second];
  }

  async acquire(): Promise<boolean> {
    if (this.holder !== null && this.holder !== this.self) return false;
    this.holder = this.self;
    return true;
  }

  async renew(): Promise<boolean> {
    return this.holder === this.self;
  }

  async release(): Promise<void> {
    if (this.holder === this.self) this.holder = null;
  }

  /** Hand the lease to somebody else, so renewals start coming back false. */
  stealForAnotherProcess(): void {
    this.holder = Symbol("other-process");
  }
}

function tenantSourceOf(ids: string[]): TenantSource {
  return {
    async findTenantIdsAfter({ cursor, limit }) {
      const start = cursor === null ? 0 : ids.indexOf(cursor) + 1;
      return ids.slice(start, start + limit);
    },
  };
}

function migrationOf(
  name: string,
  migrateTenant: SystemMigration["migrateTenant"],
): SystemMigration {
  return {
    name,
    title: name,
    description: name,
    runsAutomaticallyOnSelfHosted: true,
    migrateTenant,
  };
}

const finalized: TenantMigrationOutcome = { status: "finalized" };

describe("SystemMigrationRunnerService", () => {
  let state: FakeStateRepository;

  beforeEach(() => {
    state = new FakeStateRepository();
  });

  describe("when two processes boot at the same moment", () => {
    /** @scenario "One process drives the migration at a time" */
    it("lets exactly one acquire the lease while the other stands down", async () => {
      const [leaseA, leaseB] = FakeLeaseRepository.shared();
      const touched: string[] = [];
      const migration = migrationOf("m1", async ({ tenantId }) => {
        touched.push(tenantId);
        // Hold the lease across the other runner's whole attempt.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return finalized;
      });
      const deps = {
        state,
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      };
      const runnerA = new SystemMigrationRunnerService({
        ...deps,
        lease: leaseA,
      });
      const runnerB = new SystemMigrationRunnerService({
        ...deps,
        lease: leaseB,
      });

      const [summaryA, summaryB] = await Promise.all([
        runnerA.runPass(),
        // Give runner A the first tick so the race is deterministic.
        new Promise((resolve) => setTimeout(resolve, 5)).then(() =>
          runnerB.runPass(),
        ),
      ]);

      expect(summaryA?.finalized).toBe(1);
      expect(summaryB).toBeNull();
      expect(touched).toEqual(["acme"]);
    });
  });

  describe("when the cohort excludes a tenant", () => {
    /** @scenario "Cloud rollout processes only enrolled organizations" */
    it("processes cohort tenants and records nothing for the rest", async () => {
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme", "globex"]),
        cohort: ({ tenantId }) => tenantId === "acme",
        migrations: [migrationOf("m1", migrate)],
      });

      const summary = await runner.runPass();

      expect(migrate).toHaveBeenCalledTimes(1);
      expect(migrate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "acme" }),
      );
      expect(summary?.skipped).toBe(1);
      expect(
        await state.findRecord({ migrationName: "m1", tenantId: "globex" }),
      ).toBeNull();
    });
  });

  describe("when a migration throws for one tenant", () => {
    /** @scenario "An organization that fails mid-migration is parked and retried" */
    it("parks that tenant with the error, continues the fleet, and retries next pass", async () => {
      let failures = 0;
      const migration = migrationOf("m1", async ({ tenantId }) => {
        if (tenantId === "acme" && failures === 0) {
          failures += 1;
          throw new Error("storage unavailable");
        }
        return finalized;
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme", "globex"]),
        cohort: () => true,
        migrations: [migration],
      });

      const first = await runner.runPass();
      expect(first?.parked).toBe(1);
      expect(first?.finalized).toBe(1);
      const parked = await state.findRecord({
        migrationName: "m1",
        tenantId: "acme",
      });
      expect(parked?.status).toBe("parked");
      expect(parked?.report).toMatchObject({
        kind: "error",
        message: "storage unavailable",
      });

      const second = await runner.runPass();
      expect(second?.finalized).toBe(1);
      const healed = await state.findRecord({
        migrationName: "m1",
        tenantId: "acme",
      });
      expect(healed?.status).toBe("finalized");
    });
  });

  describe("when a tenant was finalized on an earlier pass", () => {
    /** @scenario "A finalized organization is never processed again" */
    it("skips it without calling the migration", async () => {
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "finalized",
        report: null,
      });
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      const summary = await runner.runPass();

      expect(migrate).not.toHaveBeenCalled();
      expect(summary?.skipped).toBe(1);
    });
  });

  describe("when an operator rolled a tenant back", () => {
    /** @scenario "An operator rolls a finalized organization back to its legacy path" */
    it("skips it, and keeps skipping it on later passes", async () => {
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "rolled_back",
        report: null,
      });
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      await runner.runPass();
      const summary = await runner.runPass();

      // The point of the status: without it the next pass would re-run a
      // migration whose proof still passes and undo the rollback.
      expect(migrate).not.toHaveBeenCalled();
      expect(summary?.skipped).toBe(1);
      expect(
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))
          ?.status,
      ).toBe("rolled_back");
    });
  });

  describe("when an operator rolled back a tenant that was only migrated, never finalized", () => {
    /** @scenario "An operator rolls a migrated organization back to its legacy path" */
    it("skips it exactly as it would a rolled-back finalized tenant", async () => {
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "migrated",
        report: { diffs: ["budgets:view at org"] },
      });
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "rolled_back",
        report: { diffs: ["budgets:view at org"] },
      });
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      const summary = await runner.runPass();

      // A held (migrated) tenant is normally re-run every pass; rolled_back
      // pins it exactly like a rolled-back finalized tenant, whatever state
      // it came from.
      expect(migrate).not.toHaveBeenCalled();
      expect(summary?.skipped).toBe(1);
      expect(
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))
          ?.status,
      ).toBe("rolled_back");
    });
  });

  describe("when an operator pins a tenant rolled_back while its migration is still running", () => {
    /** @scenario "A pass already in flight cannot overwrite an operator's rollback" */
    it("discards the pass's outcome instead of overwriting the pin", async () => {
      // The interleaving: the pass reads "migrated", starts the (slow)
      // migration, and the operator pins the row before the outcome write.
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "migrated",
        report: { diffs: ["budgets:view at org"] },
      });
      const migration = migrationOf("m1", async () => {
        await state.upsertRecord({
          migrationName: "m1",
          tenantId: "acme",
          status: "rolled_back",
          report: { rolledBack: { by: "user_alex" } },
        });
        return finalized;
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      const summary = await runner.runPass();

      const record = await state.findRecord({
        migrationName: "m1",
        tenantId: "acme",
      });
      expect(record?.status).toBe("rolled_back");
      expect(record?.report).toEqual({ rolledBack: { by: "user_alex" } });
      // The pin won: nothing finalized, the tenant reads as skipped.
      expect(summary?.finalized).toBe(0);
      expect(summary?.skipped).toBe(1);
    });

    /** @scenario "A pass already in flight cannot overwrite an operator's rollback" */
    it("never parks over the pin when the migration then throws", async () => {
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "migrated",
        report: null,
      });
      const migration = migrationOf("m1", async () => {
        await state.upsertRecord({
          migrationName: "m1",
          tenantId: "acme",
          status: "rolled_back",
          report: { rolledBack: { by: "user_alex" } },
        });
        throw new Error("storage gave out mid-pass");
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      await runner.runPass();

      // A `parked` row would be retried on the next pass and re-finalized -
      // the exact undo the pin exists to prevent.
      expect(
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))
          ?.status,
      ).toBe("rolled_back");
    });
  });

  describe("when the previous attempt for a tenant parked", () => {
    it("hands the migration that record so it can finish stranded work", async () => {
      await state.upsertRecord({
        migrationName: "m1",
        tenantId: "acme",
        status: "parked",
        report: { kind: "error", message: "epoch bump failed" },
      });
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      await runner.runPass();

      expect(migrate).toHaveBeenCalledWith(
        expect.objectContaining({
          previous: expect.objectContaining({ status: "parked" }),
        }),
      );
    });
  });

  describe("when the lease is lost while one tenant is still migrating", () => {
    /** @scenario "The pass keeps its lease while one large organization migrates" */
    it("stops at the next tenant rather than double-driving the fleet", async () => {
      const lease = new FakeLeaseRepository();
      const touched: string[] = [];
      const migration = migrationOf("m1", async ({ tenantId }) => {
        touched.push(tenantId);
        // Outlive the renew interval, then lose the lease to another driver
        // mid-tenant - the case a between-tenants renewal cannot detect.
        if (tenantId === "acme") {
          lease.stealForAnotherProcess();
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return finalized;
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease,
        tenants: tenantSourceOf(["acme", "globex"]),
        cohort: () => true,
        migrations: [migration],
        leaseTtlMs: 50,
        leaseRenewIntervalMs: 5,
      });

      const summary = await runner.runPass();

      expect(touched).toEqual(["acme"]);
      expect(summary?.tenantsSeen).toBe(1);
      expect(
        await state.findRecord({ migrationName: "m1", tenantId: "globex" }),
      ).toBeNull();
    });
  });

  describe("when a migration reports disagreements", () => {
    it("holds the tenant as migrated with the report and re-runs it next pass", async () => {
      const outcomes: TenantMigrationOutcome[] = [
        { status: "migrated", report: { diffs: ["budgets:view at org"] } },
        finalized,
      ];
      let call = 0;
      const migration = migrationOf("m1", async () => {
        const outcome = outcomes[call];
        call += 1;
        if (!outcome) throw new Error("unexpected extra call");
        return outcome;
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      const first = await runner.runPass();
      expect(first?.held).toBe(1);
      const held = await state.findRecord({
        migrationName: "m1",
        tenantId: "acme",
      });
      expect(held?.status).toBe("migrated");
      expect(held?.report).toMatchObject({ diffs: ["budgets:view at org"] });

      const second = await runner.runPass();
      expect(second?.finalized).toBe(1);
    });
  });

  describe("when the pass is aborted", () => {
    it("stops between tenants and releases the lease", async () => {
      const controller = new AbortController();
      const lease = new FakeLeaseRepository();
      const migration = migrationOf("m1", async () => {
        controller.abort();
        return finalized;
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease,
        tenants: tenantSourceOf(["acme", "globex"]),
        cohort: () => true,
        migrations: [migration],
      });

      const summary = await runner.runPass({ signal: controller.signal });

      expect(summary?.tenantsSeen).toBe(1);
      expect(
        await state.findRecord({ migrationName: "m1", tenantId: "globex" }),
      ).toBeNull();
      expect(await lease.acquire()).toBe(true);
    });
  });

  describe("when the tenant source pages", () => {
    it("walks every page with the last id as the cursor", async () => {
      const ids = Array.from(
        { length: 250 },
        (_, i) => `org-${String(i).padStart(3, "0")}`,
      );
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(ids),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      const summary = await runner.runPass();

      expect(summary?.finalized).toBe(250);
      expect(migrate).toHaveBeenCalledTimes(250);
    });
  });
});
