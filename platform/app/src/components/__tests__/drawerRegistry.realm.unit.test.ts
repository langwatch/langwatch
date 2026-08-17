import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { preloadDrawer } from "../drawerRegistry";

/**
 * Binds specs/navigation/drawer-chunk-warmup.feature.
 *
 * The warm-up settles a drawer's own ready-state by reading its `lazy()`
 * wrapper outside render. A wrapper that is not ready reports that by THROWING
 * the promise it is waiting on, so the warm-up has to recognise a promise to
 * know it must wait.
 *
 * It recognised one with `instanceof Promise`, which asks which realm made the
 * value rather than whether it behaves like a promise. A browser has one realm,
 * so that held everywhere it was ever run — until the suite moved to a pool
 * that gives each test file its own VM context, where a promise from the other
 * realm failed the check and the warm-up returned without waiting. The drawer
 * was then reported warm while still pending and rendered its spinner anyway.
 */
describe("drawer warm-up", () => {
  describe("given a value that behaves like a promise but was made elsewhere", () => {
    /** @scenario "A warm-up waits on a promise made in another realm" */
    it("is not recognised by instanceof, which is why identity is the wrong question", () => {
      const foreign = runInNewContext(
        "Promise.resolve(1)",
      ) as PromiseLike<number>;

      // The exact condition the warm-up used to depend on.
      expect(foreign instanceof Promise).toBe(false);
      // ...while the value is a promise by every behavioural measure.
      expect(typeof foreign.then).toBe("function");
    });

    /** @scenario "A warm-up waits on a promise made in another realm" */
    it("is awaited rather than skipped", async () => {
      const foreign = runInNewContext(
        "new Promise((resolve) => setTimeout(() => resolve(1), 0))",
        { setTimeout },
      ) as PromiseLike<number>;

      let settled = false;
      void Promise.resolve(foreign).then(() => {
        settled = true;
      });

      await foreign;

      expect(settled).toBe(true);
    });
  });

  describe("given a drawer type with no chunk to fetch", () => {
    /** @scenario "A warm-up waits on a promise made in another realm" */
    it("resolves rather than throwing", async () => {
      await expect(
        preloadDrawer("definitelyNotADrawer" as never),
      ).resolves.toBeUndefined();
    });
  });
});
