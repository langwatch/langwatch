/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-stuck-states-locks.feature
 * Proves C3 of the stuck-states review; `it.fails` until the settle rule is decided.
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

/** What `RedisMigrationLeaseRepository` answers with no Redis, or on any Redis error. */
const unreachable: MigrationLeaseRepository = {
  acquire: async () => false,
  renew: async () => false,
  release: async () => {},
};

describe("settling a tenant step after a pass", () => {
  describe("when the lease store is unreachable and no tenant was worked", () => {
    /** @scenario "A pass that worked no tenant leaves the tenant step pending" */
    it.fails("leaves the step's ledger row pending", async () => {
      const state = MemoryTenantStepStateRepository.create();
      const ledger = MemoryTenantStepLedgerRepository.create();
      const summary = await new SystemMigrationRunnerService({
        now: () => Temporal.Now.instant(),
        state,
        lease: unreachable,
        tenants: { findTenantIdsAfter: async ({ cursor }) => (cursor ? [] : ["org-1", "org-2"]) },
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
      }).runPass();
      expect(summary).toMatchObject({ tenantsSeen: 2, claimed: 2, finalized: 0 });

      await TenantStepSettleService.create({ state, ledger }).settle({ ids: [STEP] });

      expect(ledger.isSettled({ id: STEP })).toBe(false);
    });
  });
});
