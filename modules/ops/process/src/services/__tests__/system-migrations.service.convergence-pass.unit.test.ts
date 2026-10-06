import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { SystemMigrationsServiceDependencies } from "../../rules/system-migration-support.rules.ts";
import { SystemMigrationsService } from "../system-migrations.service.ts";

const PASS: MigrationPassSummary = {
  tenantsSeen: 2,
  finalized: 1,
  held: 0,
  parked: 0,
  skipped: 0,
  alreadyFinalized: 1,
  alreadyRolledBack: 0,
  claimed: 1,
  advanced: 1,
  finiteHeld: 0,
};

describe("given the tasks process's startup convergence", () => {
  describe("when it asks ops for one pass", () => {
    it("runs the pass under the caller's signal and answers its summary", async () => {
      const runPass = vi.fn(async () => PASS);
      const service = SystemMigrationsService.create(
        createApiFixture<SystemMigrationsServiceDependencies>({ runPass }, "system migration deps"),
      );
      const signal = new AbortController().signal;

      await expect(service.runConvergencePass({ signal })).resolves.toEqual(PASS);
      expect(runPass).toHaveBeenCalledWith({ signal });
    });
  });
});
