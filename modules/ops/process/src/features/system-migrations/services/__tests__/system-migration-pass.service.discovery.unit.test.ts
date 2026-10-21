import type { TenantMigrationStatus } from "@langwatch/system-migrations";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { defineMigrationStep, type TenantMigrationStep } from "@langwatch/upgrade/step";
import {
  MemoryTenantStepLedgerRepository,
  MemoryTenantStepStateRepository,
  TenantStepSettleService,
} from "@langwatch/upgrade/step/tenant-state";
import { describe, expect, it } from "vitest";

import { MemoryMigrationLeaseRepository } from "../../../../repositories/memory/memory.migration-lease.repository.ts";
import { PostgresOpsRepositories } from "../../../../repositories/prisma/prisma.ops.repositories.ts";
import { NullQueueRepository } from "../../../../repositories/queue.repository.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const STEP = "prompt:seed-default-tags";

function stepOf({
  id,
  enrolledAutomatically = true,
}: {
  id: string;
  enrolledAutomatically?: boolean;
}): TenantMigrationStep {
  return defineMigrationStep({
    id,
    kind: "tenant",
    mode: "background",
    description: id,
    tenants: "organization",
    title: id,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically,
    migrateTenant: async () => ({ status: "finalized" }),
  });
}

function gate({
  isSaaS = false,
  steps = [],
}: {
  isSaaS?: boolean;
  steps?: readonly TenantMigrationStep[];
}) {
  const state = MemoryTenantStepStateRepository.create();
  const passes = SystemMigrationPassService.create({
    repositories: {
      ...PostgresOpsRepositories.create({ prisma: prismaDouble({}) }),
      migrationLease: MemoryMigrationLeaseRepository.create(),
      queues: NullQueueRepository.create(),
    },
    isSaaS: () => isSaaS,
    newbornSweep: async () => {},
    declared: {
      steps: () => steps,
      state,
      settle: TenantStepSettleService.create({
        state,
        ledger: MemoryTenantStepLedgerRepository.create(),
      }),
    },
  });
  type Row = { name: string; status: TenantMigrationStatus; tenantId?: string };
  return {
    passes,
    state,
    record: ({ name, status, tenantId = "org-1" }: Row) =>
      state.upsertRecord({ migrationName: name, tenantId, status, report: null }),
  };
}

describe("SystemMigrationPassService.hasTenantAwaitingRedrive", () => {
  describe("given a fresh install whose automatic step no tenant has met", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes } = gate({ steps: [stepOf({ id: "identity:backfill" })] });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given every tenant finalised an old step and a release declares a new one", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes, record } = gate({
        steps: [stepOf({ id: "probe:old" }), stepOf({ id: "probe:new" })],
      });
      await record({ name: "probe:old", status: "finalized" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given a declared tenant step no pass has driven", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass, and stops asking once a tenant finalised it", async () => {
      const { passes, record } = gate({ steps: [stepOf({ id: STEP })] });
      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);

      await record({ name: STEP, status: "finalized" });
      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given a declared tenant step with a parked tenant beside a finalised one", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes, record } = gate({ steps: [stepOf({ id: STEP })] });
      await record({ name: STEP, status: "finalized" });
      await record({ name: STEP, status: "parked", tenantId: "org-2" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given a declared step whose only hold waits on a person", () => {
    /** @scenario "A tenant waiting on a person still wakes the re-drive" */
    it("asks for a pass, so the tenant moves once the person acts", async () => {
      const { passes, state } = gate({ steps: [stepOf({ id: STEP })] });
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "user-sam",
        status: "migrated",
        report: null,
        heldReason: "person",
      });

      expect(await state.hasUnsettledTenant({ migrationName: STEP })).toBe(false);
      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given every declared step is finalised", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes, record } = gate({ steps: [stepOf({ id: "probe:old" })] });
      await record({ name: "probe:old", status: "finalized" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given an operator rolled every touched tenant back", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes, record } = gate({ steps: [stepOf({ id: "probe:old" })] });
      await record({ name: "probe:old", status: "rolled_back" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given a cloud step still soaking that no organization is enrolled in", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes } = gate({
        isSaaS: true,
        steps: [stepOf({ id: "probe:soaking", enrolledAutomatically: false })],
      });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });
});
