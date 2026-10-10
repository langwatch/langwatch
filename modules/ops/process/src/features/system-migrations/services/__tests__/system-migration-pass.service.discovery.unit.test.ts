import type { SystemMigration, TenantMigrationStatus } from "@langwatch/system-migrations";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import {
  MemoryTenantStepLedgerRepository,
  MemoryTenantStepStateRepository,
  TenantStepSettleService,
} from "@langwatch/upgrade/step/tenant-state";
import { describe, expect, it } from "vitest";

import { MemoryMigrationLeaseRepository } from "../../../../repositories/memory/memory.migration-lease.repository.ts";
import { MemorySystemMigrationStateRepository } from "../../../../repositories/memory/memory.system-migration-state.repository.ts";
import { PostgresOpsRepositories } from "../../../../repositories/prisma/prisma.ops.repositories.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const STEP = "prompt:seed-default-tags";

function migration({
  name,
  enrolledAutomatically = true,
}: {
  name: string;
  enrolledAutomatically?: boolean;
}): SystemMigration {
  return {
    name,
    title: name,
    description: name,
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically,
    migrateTenant: async () => ({ status: "finalized" }),
  };
}

function gate({
  isSaaS = false,
  migrations = [],
  withStep = false,
}: {
  isSaaS?: boolean;
  migrations?: readonly SystemMigration[];
  withStep?: boolean;
}) {
  const state = MemorySystemMigrationStateRepository.create();
  const stepState = MemoryTenantStepStateRepository.create();
  const step = defineMigrationStep({
    id: STEP,
    kind: "tenant",
    mode: "background",
    description: "Seeds the default prompt tags into every organization.",
    tenants: "organization",
    title: "Default prompt tags",
    requiresOperatorConfirmation: false,
    runsAutomaticallyOnSelfHosted: true,
    enrolledAutomatically: true,
    migrateTenant: async () => ({ status: "finalized" }),
  });
  const passes = SystemMigrationPassService.create({
    repositories: {
      ...PostgresOpsRepositories.create({ prisma: prismaDouble({}) }),
      migrationState: state,
      migrationLease: MemoryMigrationLeaseRepository.create(),
    },
    isSaaS: () => isSaaS,
    migrations: () => migrations,
    userMigrations: () => [],
    newbornSweep: async () => {},
    declared: {
      steps: () => (withStep ? [step] : []),
      state: stepState,
      settle: TenantStepSettleService.create({
        state: stepState,
        ledger: MemoryTenantStepLedgerRepository.create(),
      }),
    },
  });
  type Row = { name: string; status: TenantMigrationStatus; tenantId?: string };
  const record = ({ name, status, tenantId = "org-1" }: Row) => ({
    migrationName: name,
    tenantId,
    status,
    report: null,
  });
  return {
    passes,
    record: (row: Row) => state.upsertRecord(record(row)),
    recordStep: (row: Omit<Row, "name">) => stepState.upsertRecord(record({ name: STEP, ...row })),
  };
}

describe("SystemMigrationPassService.hasTenantAwaitingRedrive", () => {
  describe("given a fresh install whose automatic migration no tenant has met", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes } = gate({ migrations: [migration({ name: "identity:backfill" })] });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given every tenant finalised an old migration and a release registers a new one", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes, record } = gate({
        migrations: [migration({ name: "old" }), migration({ name: "new" })],
      });
      await record({ name: "old", status: "finalized" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given a declared tenant step no pass has driven", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass, and stops asking once a tenant finalised it", async () => {
      const { passes, recordStep } = gate({ withStep: true });
      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);

      await recordStep({ status: "finalized" });
      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given a declared tenant step with a parked tenant beside a finalised one", () => {
    /** @scenario "The worker's re-drive discovers a tenant migration no pass has run" */
    it("asks for a pass", async () => {
      const { passes, recordStep } = gate({ withStep: true });
      await recordStep({ status: "finalized" });
      await recordStep({ status: "parked", tenantId: "org-2" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);
    });
  });

  describe("given every registered migration is finalised", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes, record } = gate({ migrations: [migration({ name: "old" })] });
      await record({ name: "old", status: "finalized" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given an operator rolled every touched tenant back", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes, record } = gate({ migrations: [migration({ name: "old" })] });
      await record({ name: "old", status: "rolled_back" });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });

  describe("given a cloud migration still soaking that no organization is enrolled in", () => {
    /** @scenario "A latched fleet skips the worker's re-drive" */
    it("skips the pass", async () => {
      const { passes } = gate({
        isSaaS: true,
        migrations: [migration({ name: "soaking", enrolledAutomatically: false })],
      });

      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });
});
