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

  async hasFinalizedTenant({
    migrationName,
  }: {
    migrationName: string;
  }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) =>
        record.migrationName === migrationName &&
        record.status === "finalized",
    );
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

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    const key = this.key(record.migrationName, record.tenantId);
    if (this.records.get(key)?.status === "rolled_back") return false;
    this.records.set(key, record);
    return true;
  }
}

class FakeLeaseRepository implements MigrationLeaseRepository {
  private readonly self = Symbol("lease-holder");
  private readonly holders: Map<string, symbol>;

  constructor(holders?: Map<string, symbol>) {
    this.holders = holders ?? new Map();
  }

  /** Two repositories over one holder table: two processes, one Redis. */
  static shared(): [FakeLeaseRepository, FakeLeaseRepository] {
    const holders = new Map<string, symbol>();
    return [new FakeLeaseRepository(holders), new FakeLeaseRepository(holders)];
  }

  async acquire({ name }: { name: string; ttlMs: number }): Promise<boolean> {
    const holder = this.holders.get(name);
    if (holder !== undefined && holder !== this.self) return false;
    this.holders.set(name, this.self);
    return true;
  }

  async renew({ name }: { name: string; ttlMs: number }): Promise<boolean> {
    return this.holders.get(name) === this.self;
  }

  async release({ name }: { name: string }): Promise<void> {
    if (this.holders.get(name) === this.self) this.holders.delete(name);
  }

  /** Hand one claim to somebody else, so its renewals come back false. */
  stealForAnotherProcess(name: string): void {
    this.holders.set(name, Symbol("other-process"));
  }

  heldNames(): string[] {
    return [...this.holders.keys()];
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
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: false,
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
    /** @scenario "Each organization is claimed by one process at a time" */
    it("lets exactly one claim each organization while the other moves on", async () => {
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
        new Promise((resolve) => setTimeout(resolve, 5)).then(() => runnerB.runPass()),
      ]);

      expect(summaryA.finalized).toBe(1);
      // B's pass ran - it did not stand down - but left "acme" to A.
      expect(summaryB.claimed).toBe(1);
      expect(summaryB.finalized).toBe(0);
      expect(touched).toEqual(["acme"]);
    });
  });

  describe("when several organizations are pending", () => {
    /** @scenario "A pass migrates several organizations at once" */
    it("works them concurrently, so one slow organization never holds up the rest", async () => {
      let inFlight = 0;
      let peak = 0;
      const completed: string[] = [];
      const migration = migrationOf("m1", async ({ tenantId }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) =>
          setTimeout(resolve, tenantId === "org-00" ? 40 : 5),
        );
        inFlight -= 1;
        completed.push(tenantId);
        return finalized;
      });
      const ids = Array.from(
        { length: 12 },
        (_, i) => `org-${String(i).padStart(2, "0")}`,
      );
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(ids),
        cohort: () => true,
        migrations: [migration],
      });

      const summary = await runner.runPass();

      expect(summary.finalized).toBe(12);
      expect(peak).toBeGreaterThan(1);
      // The LAST organization still finishes before the slow first one: a
      // pool keeps pulling past the straggler, where a chunked convoy would
      // hold the tail behind org-00's sleep.
      expect(completed.indexOf("org-11")).toBeLessThan(completed.indexOf("org-00"));
    });
  });

  describe("when reading one tenant's state throws", () => {
    it("parks that tenant in the summary and finishes the rest of the pass", async () => {
      const failingState = new FakeStateRepository();
      const originalFindRecord = failingState.findRecord.bind(failingState);
      failingState.findRecord = async (args) => {
        if (args.tenantId === "acme") throw new Error("postgres blinked");
        return originalFindRecord(args);
      };
      const migrate = vi.fn(async () => finalized);
      const runner = new SystemMigrationRunnerService({
        state: failingState,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme", "globex", "initech"]),
        cohort: () => true,
        migrations: [migrationOf("m1", migrate)],
      });

      const summary = await runner.runPass();

      // The throw is contained in the pool worker: the pass resolves with a
      // summary (never rejects), the broken tenant counts as parked with no
      // record (still pending, retried next pass), and the others finalize.
      expect(summary.parked).toBe(1);
      expect(summary.finalized).toBe(2);
      expect(
        await failingState.findRecord({
          migrationName: "m1",
          tenantId: "globex",
        }),
      ).toMatchObject({ status: "finalized" });
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
      expect(migrate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "acme" }));
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
      // Already done before this pass - counted apart from cohort skips, so
      // a run over only-finalized tenants still reads as done.
      expect(summary?.alreadyFinalized).toBe(1);
      expect(summary?.alreadyRolledBack).toBe(0);
      expect(summary?.skipped).toBe(0);
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
      expect(summary?.alreadyRolledBack).toBe(1);
      expect(
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))?.status,
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
      expect(summary?.alreadyRolledBack).toBe(1);
      expect(
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))?.status,
      ).toBe("rolled_back");
    });
  });

  describe("when an operator pins a tenant rolled_back while its migration is still running", () => {
    /** @scenario "A pass in flight cannot overwrite an operator's rollback" */
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

    /** @scenario "A pass in flight cannot overwrite an operator's rollback" */
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
        (await state.findRecord({ migrationName: "m1", tenantId: "acme" }))?.status,
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

  describe("when a claim is lost while one tenant is still migrating", () => {
    /** @scenario "The pass keeps its claim while one large organization migrates" */
    it("stops that tenant's remaining migrations and carries on with the rest", async () => {
      const lease = new FakeLeaseRepository();
      const touched: string[] = [];
      const migrationBody = async ({
        tenantId,
        name,
      }: {
        tenantId: string;
        name: string;
      }) => {
        touched.push(`${name}:${tenantId}`);
        // Outlive the renew interval, then lose the claim to another driver
        // mid-tenant - the case a between-migrations renewal cannot detect.
        if (tenantId === "acme" && name === "m1") {
          lease.stealForAnotherProcess("tenant:acme");
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        return finalized;
      };
      const runner = new SystemMigrationRunnerService({
        state,
        lease,
        tenants: tenantSourceOf(["acme", "globex"]),
        cohort: () => true,
        migrations: [
          migrationOf("m1", ({ tenantId }) => migrationBody({ tenantId, name: "m1" })),
          migrationOf("m2", ({ tenantId }) => migrationBody({ tenantId, name: "m2" })),
        ],
        leaseTtlMs: 50,
        leaseRenewIntervalMs: 5,
      });

      const summary = await runner.runPass();

      // The stolen claim stops "acme" before m2; "globex" is unaffected.
      expect(touched).toContain("m1:acme");
      expect(touched).not.toContain("m2:acme");
      expect(touched).toContain("m1:globex");
      expect(touched).toContain("m2:globex");
      expect(summary.tenantsSeen).toBe(2);
      expect(
        await state.findRecord({ migrationName: "m2", tenantId: "acme" }),
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
    it("stops between tenants and releases every claim", async () => {
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
        // Serial on purpose: with a wider pool "globex" is already in
        // flight before the abort lands, which is fine but not this test.
        tenantConcurrency: 1,
        cohort: () => true,
        migrations: [migration],
      });

      const summary = await runner.runPass({ signal: controller.signal });

      expect(summary?.tenantsSeen).toBe(1);
      expect(
        await state.findRecord({ migrationName: "m1", tenantId: "globex" }),
      ).toBeNull();
      // Every claim released, aborted mid-pass or not.
      expect(lease.heldNames()).toEqual([]);
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

  describe("when a caller needs to know whether the pass moved anything", () => {
    /** @scenario "The runner drives passes until nothing advances" */
    it("counts a first record and a status change as advances", async () => {
      const outcomes: TenantMigrationOutcome[] = [
        { status: "migrated", report: { outstanding: 1 } },
        { status: "finalized" },
      ];
      const migration = migrationOf("m1", async () => {
        return outcomes.shift() ?? { status: "finalized" };
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      // Pending -> migrated: a tenant that had no record now has one.
      expect((await runner.runPass()).advanced).toBe(1);
      // migrated -> finalized: the transition a second pass exists to make.
      expect((await runner.runPass()).advanced).toBe(1);
    });

    /** @scenario "A held tenant that never advances does not loop forever" */
    it("counts nothing for a held tenant re-proved into the same status", async () => {
      const migration = migrationOf("m1", async () => ({
        status: "migrated" as const,
        report: { outstanding: ["still disagreeing"] },
      }));
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      const first = await runner.runPass();
      const second = await runner.runPass();

      // The tenant is visited and written on BOTH passes - `held` cannot
      // tell them apart, which is exactly why `advanced` exists.
      expect(first.held).toBe(1);
      expect(second.held).toBe(1);
      expect(first.advanced).toBe(1);
      expect(second.advanced).toBe(0);
    });

    /** @scenario "A held tenant that never advances does not loop forever" */
    it("counts nothing for a tenant that parks the same way twice", async () => {
      const migration = migrationOf("m1", async () => {
        throw new Error("still broken");
      });
      const runner = new SystemMigrationRunnerService({
        state,
        lease: new FakeLeaseRepository(),
        tenants: tenantSourceOf(["acme"]),
        cohort: () => true,
        migrations: [migration],
      });

      expect((await runner.runPass()).advanced).toBe(1);
      // A permanently broken tenant must not keep a convergence loop alive.
      expect((await runner.runPass()).advanced).toBe(0);
    });

    /** @scenario "A pass in flight cannot overwrite an operator's rollback" */
    it("counts nothing for a tenant an operator has pinned rolled back", async () => {
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

      const summary = await runner.runPass();

      // The pin is terminal, so no later pass in a loop re-claims the
      // tenant, and it never keeps the loop running either.
      expect(migrate).not.toHaveBeenCalled();
      expect(summary.alreadyRolledBack).toBe(1);
      expect(summary.advanced).toBe(0);
    });
  });
});
