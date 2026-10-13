/**
 * @see packages/upgrade/specs/tenant-step-settle.feature
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 */
import {
  type MigrationLeaseRepository,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  MemoryTenantStepLedgerRepository,
  MemoryTenantStepStateRepository,
} from "../memory.tenant-state.repository.ts";
import { TenantStepSettleService } from "../tenant-step-settle.service.ts";

const STEP = "prompt:seed-default-tags";
const TENANTS = ["org-1", "org-2"];

/** What `RedisMigrationLeaseRepository` answers with no Redis, or on any Redis error. */
const unreachable: MigrationLeaseRepository = {
  acquire: async () => false,
  renew: async () => false,
  release: async () => {},
};

function settling() {
  const state = MemoryTenantStepStateRepository.create();
  const ledger = MemoryTenantStepLedgerRepository.create();
  const runner = new SystemMigrationRunnerService({
    now: () => Temporal.Now.instant(),
    state,
    lease: unreachable,
    tenants: { findTenantIdsAfter: async ({ cursor }) => (cursor ? [] : TENANTS) },
    cohort: () => true,
    migrations: [
      {
        name: STEP,
        title: STEP,
        description: STEP,
        requiresOperatorConfirmation: false,
        runsAutomaticallyOnSelfHosted: true,
        enrolledAutomatically: true,
        migrateTenant: async () => ({ status: "finalized" }),
      },
    ],
  });
  const service = TenantStepSettleService.create({ state, ledger });
  const settle = () => service.settle({ buckets: [{ ids: [STEP], runner }] });
  const record = (tenantId: string, fields: { status: "finalized" | "migrated" | "parked" }) =>
    state.upsertRecord({
      migrationName: STEP,
      tenantId,
      report: null,
      ...fields,
      ...(fields.status === "migrated" ? { heldReason: "pending" as const } : {}),
    });
  return { runner, ledger, settle, record };
}

describe("TenantStepSettleService", () => {
  describe("when every eligible tenant holds a finished row", () => {
    /** @scenario "A tenant step's ledger row is done once no tenant is held or parked" */
    it("settles the step's ledger row", async () => {
      const { ledger, settle, record } = settling();
      await record("org-1", { status: "finalized" });
      await record("org-2", { status: "finalized" });

      expect(await settle()).toEqual([]);
      expect(ledger.isSettled({ id: STEP })).toBe(true);
    });
  });

  describe("when a later pass holds or parks a tenant", () => {
    /** @scenario "A settled tenant step reopens when a tenant is held or parked again" */
    it("reopens the step's ledger row", async () => {
      const { ledger, settle, record } = settling();
      await record("org-1", { status: "finalized" });
      await record("org-2", { status: "finalized" });
      await settle();

      await record("org-2", { status: "migrated" });
      expect(await settle()).toEqual([STEP]);
      expect(ledger.isSettled({ id: STEP })).toBe(false);

      await record("org-2", { status: "parked" });
      await settle();
      expect(ledger.isSettled({ id: STEP })).toBe(false);
    });
  });

  describe("when an eligible tenant has never been worked", () => {
    /** @scenario "A tenant step with an unworked tenant stays pending" */
    it("leaves the step pending though no tenant is held or parked", async () => {
      const { ledger, settle, record } = settling();
      await record("org-1", { status: "finalized" });

      expect(await settle()).toEqual([STEP]);
      expect(ledger.isSettled({ id: STEP })).toBe(false);
    });
  });

  describe("when the lease store is unreachable and no tenant was worked", () => {
    /** @scenario "A pass that worked no tenant leaves the tenant step pending" */
    it("leaves the step's ledger row pending", async () => {
      const { runner, ledger, settle } = settling();
      const summary = await runner.runPass();
      expect(summary).toMatchObject({ tenantsSeen: 2, claimed: 2, finalized: 0 });

      expect(await settle()).toEqual([STEP]);
      expect(ledger.isSettled({ id: STEP })).toBe(false);
    });
  });
});
