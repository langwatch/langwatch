// @vitest-environment jsdom
/**
 * The Langy home's development-only state switcher, inert once not a dev build.
 * Spec: specs/home/langy-home.feature
 */
import { UiCapabilityContextProvider, type UiCapabilities } from "@langwatch/ui-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/ui-host/testing";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  chartVariantFor,
  DEFAULT_HOME_CHART_VARIANT,
  HOME_DEV_STATES,
  setHomeDevState,
  useHomeDevState,
} from "../dev/home-dev-state";

afterEach(() => {
  window.localStorage.clear();
});

/** The one capability this hook reads, published the way the shell does. */
function withDeployment(isDevelopment: boolean) {
  const capabilities: UiCapabilities = {
    ...createUiCapabilitiesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    deployment: { isDevelopment },
  };
  return ({ children }: { children: ReactNode }) =>
    createElement(UiCapabilityContextProvider, { value: capabilities }, children);
}

describe("useHomeDevState()", () => {
  describe("given a development build", () => {
    describe("when a state is pinned", () => {
      /** @scenario Developers can preview every state of this home */
      it("reports every state the block can be in back to the page", () => {
        for (const { key } of HOME_DEV_STATES) {
          const { result, unmount } = renderHook(() => useHomeDevState(), {
            wrapper: withDeployment(true),
          });
          act(() => setHomeDevState({ state: key, isDevelopment: true }));
          expect(result.current).toBe(key);
          unmount();
        }
      });

      it("returns the page to the project's real data when it is cleared", () => {
        const { result } = renderHook(() => useHomeDevState(), {
          wrapper: withDeployment(true),
        });

        act(() => setHomeDevState({ state: "empty", isDevelopment: true }));
        expect(result.current).toBe("empty");

        act(() => setHomeDevState({ state: null, isDevelopment: true }));
        expect(result.current).toBeNull();
      });
    });

    describe("when a stranger's value is sitting in storage", () => {
      it("ignores it rather than pinning a state that does not exist", () => {
        window.localStorage.setItem("langwatch:dev:home-state", "not-a-state");

        const { result } = renderHook(() => useHomeDevState(), {
          wrapper: withDeployment(true),
        });

        expect(result.current).toBeNull();
      });
    });
  });

  describe("given a production build", () => {
    /** @scenario Developers can preview every state of this home */
    it("pins nothing, so the control has no state to render", () => {
      const { result } = renderHook(() => useHomeDevState(), {
        wrapper: withDeployment(false),
      });
      act(() => setHomeDevState({ state: "empty", isDevelopment: false }));

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
