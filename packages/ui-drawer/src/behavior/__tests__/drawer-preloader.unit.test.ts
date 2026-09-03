/**
 * @vitest-environment jsdom
 *
 * specs/navigation/drawer-chunk-warmup.feature
 *
 * Moved from `platform/app/src/hooks/__tests__/usePreloadDrawer.unit.test.ts`.
 * The application's copy mocked the one module-scope registry; the preloader is
 * built from a composed registry now, so the warm-up is a plain spy handed to
 * the hook factory and every scenario reads the same.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeUsePreload } from "../drawer-preloader";

const preloadDrawer = vi.fn((_drawer: string) => Promise.resolve());
const usePreloadDrawer = makeUsePreload(preloadDrawer);

let idleCallbacks: Array<(() => void) | undefined> = [];

const becomeIdle = () => {
  for (const callback of idleCallbacks) callback?.();
};

beforeEach(() => {
  preloadDrawer.mockClear();
  idleCallbacks = [];
  // jsdom has no idle callback of its own, so the hook would take its
  // timer fallback and the idle path would never be exercised.
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => {
    idleCallbacks[handle - 1] = undefined;
  });
});

afterEach(() => {
  // Unmount first: the hook cancels its idle callback on the way out, and the
  // stub has to still be there when it does.
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePreloadDrawer", () => {
  describe("given a screen that warms a drawer", () => {
    describe("when the screen renders", () => {
      /** @scenario "The warm-up waits for the browser to be idle" */
      it("fetches no code yet", () => {
        renderHook(() => usePreloadDrawer("scenarioEditor"));

        expect(preloadDrawer).not.toHaveBeenCalled();
      });
    });

    describe("when the browser becomes idle", () => {
      it("fetches the drawer's code", () => {
        renderHook(() => usePreloadDrawer("scenarioEditor"));

        becomeIdle();

        expect(preloadDrawer).toHaveBeenCalledWith("scenarioEditor");
      });
    });

    describe("when the screen closes before the browser is idle", () => {
      /** @scenario "Leaving the screen cancels a warm-up that has not started" */
      it("fetches no code", () => {
        const { unmount } = renderHook(() => usePreloadDrawer("scenarioEditor"));

        unmount();
        becomeIdle();

        expect(preloadDrawer).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a screen that warms two drawers", () => {
    describe("when the browser becomes idle", () => {
      it("fetches both", () => {
        renderHook(() => usePreloadDrawer("scenarioEditor", "scenarioRunDetail"));

        becomeIdle();

        expect(preloadDrawer).toHaveBeenCalledWith("scenarioEditor");
        expect(preloadDrawer).toHaveBeenCalledWith("scenarioRunDetail");
      });
    });
  });

  describe("given a browser without idle callbacks", () => {
    describe("when the wait elapses", () => {
      it("fetches the drawer's code anyway", () => {
        vi.stubGlobal("requestIdleCallback", undefined);
        vi.useFakeTimers();

        try {
          renderHook(() => usePreloadDrawer("scenarioEditor"));
          expect(preloadDrawer).not.toHaveBeenCalled();

          vi.advanceTimersByTime(1_000);

          expect(preloadDrawer).toHaveBeenCalledWith("scenarioEditor");
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
