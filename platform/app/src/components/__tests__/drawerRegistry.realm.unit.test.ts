import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { preloadDrawer, primeLazyComponent } from "../drawerRegistry";

/**
 * Binds specs/navigation/drawer-chunk-warmup.feature.
 *
 * A drawer that is not ready reports that by THROWING the promise it is waiting
 * on, so the warm-up has to recognise a promise to know it must wait. It
 * recognised one with `instanceof Promise`, which asks which realm made the
 * value rather than whether it behaves like a promise. A browser has one realm,
 * so that held everywhere it was ever run — until the suite moved to a pool
 * that gives each test file its own VM context, where a promise from the other
 * realm failed the check and the warm-up returned WITHOUT waiting. The drawer
 * was reported ready while still loading and rendered its spinner anyway.
 *
 * These drive `primeLazyComponent` itself with a wrapper that behaves like a
 * not-yet-ready `lazy()`. Asserting on a bare foreign promise instead would
 * pass whatever the warm-up does with it, which is the trap this file exists to
 * avoid.
 */
describe("drawer warm-up", () => {
  /** A `lazy()` wrapper that is still loading: `_init` throws `pending`. */
  const notReadyWrapper = (pending: unknown) => ({
    _payload: {},
    _init: () => {
      throw pending;
    },
  });

  /** A promise built in another realm, plus the resolve handle for it. */
  const foreignPromise = () => {
    const context: { resolve?: () => void; promise?: PromiseLike<void> } = {};
    runInNewContext("promise = new Promise((r) => { resolve = r; })", context as never);
    return { promise: context.promise!, resolve: context.resolve! };
  };

  describe("when a drawer reports itself pending with a promise from another realm", () => {
    /** @scenario "A warm-up finishes only once the drawer's code is ready" */
    it("does not report itself finished while the drawer is still loading", async () => {
      const { promise } = foreignPromise();

      // The exact check the warm-up used to depend on, and the reason the
      // realm matters at all.
      expect(promise instanceof Promise).toBe(false);

      let finished = false;
      void primeLazyComponent(notReadyWrapper(promise)).then(() => {
        finished = true;
      });

      // Let every already-queued microtask run. A warm-up that failed to
      // recognise the promise would have resolved by now.
      await new Promise((r) => setTimeout(r, 0));

      expect(finished).toBe(false);
    });

    /** @scenario "A warm-up finishes only once the drawer's code is ready" */
    it("reports itself finished once that promise settles", async () => {
      const { promise, resolve } = foreignPromise();

      const primed = primeLazyComponent(notReadyWrapper(promise));
      resolve();

      await expect(primed).resolves.toBeUndefined();
    });

    /** @scenario "A warm-up finishes only once the drawer's code is ready" */
    it("reports itself finished even when the drawer's code fails to arrive", async () => {
      const context: { reject?: (e: unknown) => void; promise?: unknown } = {};
      runInNewContext(
        "promise = new Promise((_, r) => { reject = r; }); promise.catch(() => {})",
        context as never,
      );
      const primed = primeLazyComponent(notReadyWrapper(context.promise));
      context.reject!(new Error("chunk never arrived"));

      // A warm-up that rejected here would take the page down for a failure
      // the user has not asked to see yet.
      await expect(primed).resolves.toBeUndefined();
    });
  });

  describe("when a drawer is already ready", () => {
    /** @scenario "A warm-up finishes only once the drawer's code is ready" */
    it("reports itself finished without waiting", async () => {
      const ready = { _payload: {}, _init: () => undefined };

      await expect(primeLazyComponent(ready)).resolves.toBeUndefined();
    });
  });

  describe("when the thing handed over is not a drawer at all", () => {
    /** @scenario "A warm-up finishes only once the drawer's code is ready" */
    it("reports itself finished rather than throwing", async () => {
      await expect(primeLazyComponent({})).resolves.toBeUndefined();
    });
  });

  describe("when a drawer type has no code to fetch", () => {
    /** @scenario "A warm-up for a drawer with nothing to fetch finishes at once" */
    it("resolves rather than throwing", async () => {
      await expect(
        preloadDrawer("definitelyNotADrawer" as never),
      ).resolves.toBeUndefined();
    });
  });
});
