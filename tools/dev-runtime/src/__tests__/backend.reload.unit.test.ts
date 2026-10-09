import { EvaluatedModules } from "vite/module-runner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReloadTrigger, invalidateModules, staleModuleIds } from "../backend.reload.ts";

describe("given the in-process reload trigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when edits keep arriving faster than the quiet window", () => {
    it("reloads once at the max wait, carrying every file", async () => {
      const run = vi.fn(async (_files: string[]) => {});
      const trigger = createReloadTrigger({ quietMs: 2_000, maxWaitMs: 30_000, run });
      for (let i = 0; i < 40; i += 1) {
        trigger.note(`/repo/f${i}.ts`);
        await vi.advanceTimersByTimeAsync(1_000);
      }
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0]).toHaveLength(30);
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
