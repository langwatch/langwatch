/**
 * The boot-chain loop refuses a fleet that never stops moving, as main's preflight did.
 * @see specs/migration/system-migrations-runner.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { driveSystemMigrationsToConvergence } from "../convergence.ts";
import type { MigrationPassSummary } from "../types.ts";

const progress: MigrationPassSummary = {
  tenantsSeen: 1,
  finalized: 1,
  held: 0,
  parked: 0,
  skipped: 0,
  alreadyFinalized: 0,
  alreadyRolledBack: 0,
  claimed: 0,
  advanced: 1,
};

describe("driveSystemMigrationsToConvergence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given passes that report progress every time", () => {
    /** @scenario "A loop that never settles stops at the cap without claiming success" */
    it("stops at the cap without rejecting, so nothing it precedes is refused", async () => {
      const runPass = vi.fn().mockResolvedValue(progress);

      const outcome = driveSystemMigrationsToConvergence({
        signal: new AbortController().signal,
        runPass,
      });
      await vi.runAllTimersAsync();

      await expect(outcome).resolves.toBeUndefined();
      expect(runPass).toHaveBeenCalledTimes(25);
    });
  });
});
