/** Spec: modules/ops/specs/ops-system-migrations.feature */
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { SystemMigrationsServiceDependencies } from "../../../../rules/system-migration-support.rules.ts";
import { SystemMigrationsService } from "../system-migrations.service.ts";

const PASS: MigrationPassSummary = {
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

function latched(runPass: SystemMigrationsServiceDependencies["runPass"]) {
  const hasTenantAwaitingRedrive = vi.fn(async () => false);
  const service = SystemMigrationsService.create(
    createApiFixture<SystemMigrationsServiceDependencies>(
      { hasTenantAwaitingRedrive, runPass },
      "system migration deps",
    ),
  );
  return { service, hasTenantAwaitingRedrive };
}

describe("SystemMigrationsService.executePass", () => {
  describe("given stored state that reads latched after a pass died part-way", () => {
    /** @scenario "Each worker process finishes an interrupted pass on its first re-drive" */
    it("runs the process's first re-drive ungated and gates the next", async () => {
      const runPass = vi.fn(async () => PASS);
      const { service, hasTenantAwaitingRedrive } = latched(runPass);

      await service.executePass({ redrive: true });
      expect(runPass).toHaveBeenCalledOnce();
      expect(hasTenantAwaitingRedrive).not.toHaveBeenCalled();

      await service.executePass({ redrive: true });
      expect(runPass).toHaveBeenCalledOnce();
      expect(hasTenantAwaitingRedrive).toHaveBeenCalledOnce();
    });

    /** @scenario "Each worker process finishes an interrupted pass on its first re-drive" */
    it("leaves the next re-drive ungated when the first pass fails", async () => {
      const runPass = vi
        .fn<SystemMigrationsServiceDependencies["runPass"]>()
        .mockRejectedValueOnce(new Error("state table unavailable"))
        .mockResolvedValue(PASS);
      const { service, hasTenantAwaitingRedrive } = latched(runPass);

      await expect(service.executePass({ redrive: true })).rejects.toThrow(
        "state table unavailable",
      );
      await service.executePass({ redrive: true });

      expect(runPass).toHaveBeenCalledTimes(2);
      expect(hasTenantAwaitingRedrive).not.toHaveBeenCalled();
    });
  });
});
