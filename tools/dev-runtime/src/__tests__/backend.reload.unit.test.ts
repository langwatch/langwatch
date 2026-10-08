import { EvaluatedModules } from "vite/module-runner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReloadTrigger, invalidateModules, staleModuleIds } from "../backend.reload.ts";

const MINUTE = 60_000;

describe("given the in-process reload trigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when an agent turn keeps the hold marker renewed for minutes", () => {
    /** @scenario "A hold lasts as long as the agent turn is active" */
    it("reloads once, only after the hold is released", async () => {
      let isHeld = true;
      const run = vi.fn(async (_files: string[]) => {});
      const trigger = createReloadTrigger({
        quietMs: 2_000,
        maxWaitMs: 30_000,
        holdMs: () => (isHeld ? 30_000 : 0),
        run,
      });
      trigger.note("/repo/a.ts");
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
      expect(run).not.toHaveBeenCalled();
      isHeld = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(["/repo/a.ts"]);
      trigger.cancel();
    });
  });

  describe("when the hold marker never expires", () => {
    /** @scenario "A hold expires after the cap" */
    it("reloads once ten minutes have passed since the hold began", async () => {
      const run = vi.fn(async (_files: string[]) => {});
      const trigger = createReloadTrigger({
        quietMs: 2_000,
        maxWaitMs: 30_000,
        holdMs: () => 30_000,
        run,
      });
      trigger.note("/repo/a.ts");
      await vi.advanceTimersByTimeAsync(9 * MINUTE);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2 * MINUTE);
      expect(run).toHaveBeenCalledTimes(1);
      trigger.cancel();
    });
  });
});

describe("given modules the runner evaluated", () => {
  describe("when one file changes", () => {
    /** @scenario "A module edit reloads in-process without a new process" */
    it("drops that module and its importers, and keeps the rest cached", () => {
      const modules = new EvaluatedModules();
      const leaf = modules.ensureModule("/repo/leaf.ts", "/repo/leaf.ts");
      const importer = modules.ensureModule("/repo/importer.ts", "/repo/importer.ts");
      const untouched = modules.ensureModule("/repo/untouched.ts", "/repo/untouched.ts");
      leaf.importers.add(importer.id);
      for (const node of [leaf, importer, untouched]) node.evaluated = true;

      const ids = staleModuleIds({ modules, files: ["/repo/leaf.ts"] });
      expect([...ids].toSorted()).toEqual(["/repo/importer.ts", "/repo/leaf.ts"]);

      invalidateModules({ modules, ids });
      expect([leaf.evaluated, importer.evaluated, untouched.evaluated]).toEqual([
        false,
        false,
        true,
      ]);
    });
  });
});
