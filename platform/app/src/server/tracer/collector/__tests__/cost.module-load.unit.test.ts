import { describe, expect, it, vi } from "vitest";

/**
 * Regression guard for issue #4476.
 *
 * `cost.ts` used to fire `prewarmTiktokenModels()` as an un-awaited side effect
 * at module load (gated on `isBuildOrNoRedis`, which is TRUE under tests because
 * vitest sets BUILD_TIME=1). That kicked off a background fetch of the tiktoken
 * BPE-rank files — a network socket + WASM load — for EVERY unit-test file that
 * transitively imports `cost.ts` (metrics, span-cost-enrichment, the cost test
 * itself, ...). Under `--coverage`, vitest waits for a graceful worker exit
 * instead of force-killing the pool, so that in-flight fetch kept the worker's
 * event loop alive long after every test passed — wedging `test-unit (2)` until
 * the CI job timeout and blocking `langwatch-app-ci`.
 *
 * The real worker prewarms explicitly via `collectorWorker.ts`, so importing
 * `cost.ts` must stay side-effect-free. This test fails if anyone reintroduces a
 * module-load auto-prewarm.
 */

const { prewarmSpy } = vi.hoisted(() => ({
  prewarmSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  // A class (not an arrow fn) so `new TiktokenClient()` in cost.ts works under
  // vitest 4, which rejects non-constructable mock implementations.
  TiktokenClient: class {
    prewarm = prewarmSpy;
  },
}));

// Deliberately a single test: `await import("../cost")` resolves from vitest's
// module cache after the first load, so a second test in this file would see a
// no-op import and trivially pass. Add `vi.resetModules()` per-test if that
// ever changes.
describe("given cost.ts is imported (as it is transitively by many unit tests)", () => {
  describe("when the module finishes evaluating", () => {
    it("does not call prewarm at import time", async () => {
      await import("../cost");

      // A module-load prewarm leaks an un-awaited fetch that wedges the vitest
      // worker under coverage (#4476). Prewarming is the worker's job, not a
      // side effect of importing the cost helpers.
      expect(prewarmSpy).not.toHaveBeenCalled();
    });
  });
});
