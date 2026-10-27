import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { describe, expect, it, vi } from "vitest";

import { SystemMigrationsPassTask } from "../system-migrations-pass.task.ts";

function summary(overrides: Partial<MigrationPassSummary> = {}): MigrationPassSummary {
  return {
    tenantsSeen: 0,
    finalized: 0,
    held: 0,
    parked: 0,
    skipped: 0,
    alreadyFinalized: 0,
    alreadyRolledBack: 0,
    claimed: 0,
    advanced: 0,
    ...overrides,
  };
}

describe("SystemMigrationsPassTask", () => {
  describe("given a fleet with nothing left to advance", () => {
    /** @scenario "The boot chain drives the migrations to convergence before the process starts" */
    it("returns once a pass advances nothing so the boot chain continues", async () => {
      const pass = vi.fn().mockResolvedValue(summary({ tenantsSeen: 3, alreadyFinalized: 3 }));
      const task = SystemMigrationsPassTask.create({ pass: () => pass });

      expect(task.name).toBe("system-migrations-pass");
      await task.run({ args: [], signal: new AbortController().signal });

      expect(pass).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a pass fails outright", () => {
    /**
     * @scenario "The boot chain drives the migrations to convergence before the process starts"
     * @scenario "A failed pass ends the run without preventing startup"
     */
    it("ends the task without failing the boot chain", async () => {
      const pass = vi.fn().mockRejectedValue(new Error("the state table is down"));
      const task = SystemMigrationsPassTask.create({ pass: () => pass });

      await expect(
        task.run({ args: [], signal: new AbortController().signal }),
      ).resolves.toBeUndefined();
      expect(pass).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the passes never settle", () => {
    /** @scenario "The boot chain drives the migrations to convergence before the process starts" */
    it("stops at the cap and ends the task without failing the boot chain", async () => {
      vi.useFakeTimers();
      try {
        const pass = vi.fn().mockResolvedValue(summary({ tenantsSeen: 1, advanced: 1 }));
        const run = SystemMigrationsPassTask.create({ pass: () => pass }).run({
          args: [],
          signal: new AbortController().signal,
        });
        await vi.runAllTimersAsync();

        await expect(run).resolves.toBeUndefined();
        expect(pass).toHaveBeenCalledTimes(25);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the launcher aborts before the task starts", () => {
    /** @scenario "Cancelling startup stops the loop between passes" */
    it("starts no pass at all", async () => {
      const pass = vi.fn();
      const controller = new AbortController();
      controller.abort();

      await SystemMigrationsPassTask.create({ pass: () => pass }).run({
        args: [],
        signal: controller.signal,
      });

      expect(pass).not.toHaveBeenCalled();
    });
  });
});
