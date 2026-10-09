import { describe, expect, it } from "vitest";

import {
  MemoryTenantStepLedgerRepository,
  MemoryTenantStepStateRepository,
} from "../memory.tenant-state.repository.ts";
import { TenantStepSettleService } from "../tenant-step-settle.service.ts";

const STEP = "prompt:seed-default-tags";

function settling() {
  const state = MemoryTenantStepStateRepository.create();
  const ledger = MemoryTenantStepLedgerRepository.create();
  return { state, ledger, service: TenantStepSettleService.create({ state, ledger }) };
}

describe("TenantStepSettleService", () => {
  describe("when a pass leaves no held or parked tenant", () => {
    /** @scenario "A tenant step's ledger row is done once no tenant is held or parked" */
    it("settles the step's ledger row", async () => {
      const { state, ledger, service } = settling();
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-1",
        status: "finalized",
        report: null,
      });
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-2",
        status: "migrated",
        report: null,
      });

      await service.settle({ ids: [STEP] });

      expect(ledger.isSettled({ id: STEP })).toBe(true);
    });
  });

  describe("when a later pass holds or parks a tenant", () => {
    /** @scenario "A settled tenant step reopens when a tenant is held or parked again" */
    it("reopens the step's ledger row", async () => {
      const { state, ledger, service } = settling();
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-1",
        status: "finalized",
        report: null,
      });
      await service.settle({ ids: [STEP] });

      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-2",
        status: "migrated",
        report: null,
        heldReason: "pending",
      });
      await service.settle({ ids: [STEP] });
      expect(ledger.isSettled({ id: STEP })).toBe(false);

      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-2",
        status: "finalized",
        report: null,
      });
      await state.upsertRecord({
        migrationName: STEP,
        tenantId: "org-3",
        status: "parked",
        report: null,
      });
      await service.settle({ ids: [STEP] });
      expect(ledger.isSettled({ id: STEP })).toBe(false);
    });
  });
});
