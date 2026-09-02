// @vitest-environment jsdom
/**
 * The Langy home's development-only state switcher.
 *
 * Two things matter here and neither is the list itself: a pinned state has to
 * come back out of the hook that the block reads (otherwise the preview shows
 * nothing), and the whole mechanism has to be inert once `import.meta.env.DEV`
 * is false — that is the only thing standing between a dev convenience and a
 * customer seeing a fabricated home page.
 *
 * Spec: specs/home/langy-home.feature
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chartVariantFor,
  DEFAULT_HOME_CHART_VARIANT,
  HOME_DEV_STATES,
  setHomeDevState,
  useHomeDevState,
} from "../dev/homeDevState";

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("useHomeDevState()", () => {
  describe("given a development build", () => {
    describe("when a state is pinned", () => {
      /** @scenario Developers can preview every state of this home */
      it("reports every state the block can be in back to the page", () => {
        for (const { key } of HOME_DEV_STATES) {
          const { result, unmount } = renderHook(() => useHomeDevState());
          act(() => setHomeDevState(key));
          expect(result.current).toBe(key);
          unmount();
        }
      });

      it("returns the page to the project's real data when it is cleared", () => {
        const { result } = renderHook(() => useHomeDevState());

        act(() => setHomeDevState("empty"));
        expect(result.current).toBe("empty");

        act(() => setHomeDevState(null));
        expect(result.current).toBeNull();
      });
    });

    describe("when a stranger's value is sitting in storage", () => {
      it("ignores it rather than pinning a state that does not exist", () => {
        window.localStorage.setItem("langwatch:dev:home-state", "not-a-state");

        const { result } = renderHook(() => useHomeDevState());

        expect(result.current).toBeNull();
      });
    });
  });

  describe("given a production build", () => {
    /** @scenario Developers can preview every state of this home */
    it("pins nothing, so the control has no state to render", () => {
      vi.stubEnv("DEV", false);

      const { result } = renderHook(() => useHomeDevState());
      act(() => setHomeDevState("empty"));

      expect(result.current).toBeNull();
      expect(window.localStorage.getItem("langwatch:dev:home-state")).toBeNull();
    });
  });
});

describe("chartVariantFor()", () => {
  describe("given the three pinned figure presentations", () => {
    it("gives each one its own presentation, so they can be compared", () => {
      const variants = ["chart-strip", "chart-trend", "chart-full"].map((s) =>
        chartVariantFor(s as Parameters<typeof chartVariantFor>[0]),
      );

      expect(new Set(variants).size).toBe(3);
    });
  });

  describe("given a state with no opinion about the figures", () => {
    it("leaves the figures as the real home draws them", () => {
      for (const state of ["empty", "read-only", "morph", null] as const) {
        expect(chartVariantFor(state)).toBe(DEFAULT_HOME_CHART_VARIANT);
      }
    });
  });
});
