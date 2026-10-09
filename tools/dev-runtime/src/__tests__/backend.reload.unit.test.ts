import { EvaluatedModules } from "vite/module-runner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReloadTrigger,
  invalidateModules,
  recycleReason,
  staleModuleIds,
} from "../backend.reload.ts";

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

describe("given the in-process host's recycle bounds", () => {
  const limits = { maxGenerations: 50, maxRssMiB: 4_096 };

  describe("when it is under both bounds", () => {
    it("keeps re-linking", () => {
      expect(recycleReason({ generation: 49, rssMiB: 4_096, limits })).toBeUndefined();
    });
  });

  describe("when the serving generation reaches the generation limit", () => {
    /** @scenario "The in-process api lane hands over to a fresh process after enough generations" */
    it("recycles and names the limit", () => {
      expect(recycleReason({ generation: 50, rssMiB: 900, limits })).toBe(
        "generation 50 reached the limit of 50",
      );
    });
  });

  describe("when its RSS passes the ceiling", () => {
    /** @scenario "The in-process api lane hands over to a fresh process once its memory passes the ceiling" */
    it("recycles and names the ceiling", () => {
      expect(recycleReason({ generation: 3, rssMiB: 4_097, limits })).toBe(
        "rss 4097 MiB passed the ceiling of 4096 MiB",
      );
    });
  });

  describe("when the previous generation did not drain", () => {
    /** @scenario "A generation that did not drain is replaced by a fresh process" */
    it("recycles whatever the bounds say", () => {
      expect(recycleReason({ generation: 1, rssMiB: 300, isDrainFailed: true, limits })).toBe(
        "generation 1 did not drain",
      );
    });
  });
});
