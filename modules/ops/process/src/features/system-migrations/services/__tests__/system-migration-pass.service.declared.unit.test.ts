import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { defineMigrationStep } from "@langwatch/upgrade/step";
import {
  MemoryTenantStepLedgerRepository,
  MemoryTenantStepStateRepository,
  TenantStepSettleService,
} from "@langwatch/upgrade/step/tenant-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemorySystemMigrationStateRepository } from "../../../../repositories/memory/memory.system-migration-state.repository.ts";
import { PostgresOpsRepositories } from "../../../../repositories/prisma/prisma.ops.repositories.ts";
import { RedisMigrationLeaseRepository } from "../../../../repositories/redis/redis.migration-lease.repository.ts";
import { SystemMigrationPassService } from "../system-migration-pass.service.ts";

const STEP = "prompt:seed-default-tags";

const everyOrganization = {
  findTenantIdsAfter: async ({ cursor }: { cursor: string | null }) =>
    cursor === null ? ["org-1", "org-2"] : [],
};

function declaredPass({ held }: { held: Set<string> }) {
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
    migrateTenant: async ({ tenantId }) =>
      held.has(tenantId)
        ? { status: "migrated", report: null, heldReason: "pending" }
        : { status: "finalized" },
  });
  const state = MemoryTenantStepStateRepository.create();
  const ledger = MemoryTenantStepLedgerRepository.create();
  const passes = SystemMigrationPassService.create({
    repositories: {
      ...PostgresOpsRepositories.create({ prisma: prismaDouble({}) }),
      migrationState: MemorySystemMigrationStateRepository.create(),
      migrationLease: RedisMigrationLeaseRepository.create({ redis: null }),
      organizationTenants: { ...everyOrganization, pendingFor: () => everyOrganization },
    },
    isSaaS: () => false,
    migrations: () => [],
    userMigrations: () => [],
    newbornSweep: async () => {},
    declared: {
      steps: () => [step],
      state,
      settle: TenantStepSettleService.create({ state, ledger }),
    },
  });
  return { passes, ledger, state };
}

/** Redis reachable: every claim is granted. Without this the lease has no Redis at all. */
function redisAnswers(): void {
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "acquire").mockResolvedValue(true);
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "renew").mockResolvedValue(true);
  vi.spyOn(RedisMigrationLeaseRepository.prototype, "release").mockResolvedValue();
}

describe("SystemMigrationPassService's declared tenant steps", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("given a pass holds one of a declared tenant step's tenants", () => {
    /** @scenario "A migration pass settles the declared tenant steps it drove" */
    it("leaves the step's ledger row pending, and settles it once no tenant is held", async () => {
      redisAnswers();
      const held = new Set(["org-2"]);
      const { passes, ledger } = declaredPass({ held });

      await passes.runPass({});
      expect(ledger.isSettled({ id: STEP })).toBe(false);

      held.clear();
      await passes.runPass({});
      expect(ledger.isSettled({ id: STEP })).toBe(true);
    });
  });

  describe("given one tenant finished earlier and Redis is now down", () => {
    /** @scenario "A pending tenant step keeps waking passes until it settles" */
    it("leaves the step pending, keeps asking for passes, and settles once Redis is back", async () => {
      const { passes, ledger, state } = declaredPass({ held: new Set() });
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-1",
        status: "finalized",
        report: null,
      });

      await passes.runPass({});
      expect(ledger.isSettled({ id: STEP })).toBe(false);
      expect(await passes.hasTenantAwaitingRedrive()).toBe(true);

      redisAnswers();
      await passes.runPass({});
      expect(ledger.isSettled({ id: STEP })).toBe(true);
      expect(await passes.hasTenantAwaitingRedrive()).toBe(false);
    });
  });
});
