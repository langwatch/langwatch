// @vitest-environment jsdom
// Spec: packages/design-system/specs/loading-screen.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "../src/components/loading-screen.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

function answerMotionPreference({ reduce }: { reduce: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion") && !query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function inlineOpacitiesAbove(node: HTMLElement): string[] {
  const opacities: string[] = [];
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    if (current.style.opacity !== "") opacities.push(current.style.opacity);
  }
  return opacities;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LoadingScreen", () => {
  describe("given the loading screen has never been shown before", () => {
    describe("when it renders", () => {
      /** @scenario The logo is on the first frame of the loading screen */
      it("shows the logo at full strength without waiting on a timer", () => {
        answerMotionPreference({ reduce: false });
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null);
        vi.useFakeTimers();

        renderWithDesignSystem(<LoadingScreen />);

        const logo = screen.getByTestId("loading-screen-logo");
        expect(logo.querySelector("svg")).toBeTruthy();
        expect(inlineOpacitiesAbove(logo).filter((opacity) => opacity !== "1")).toEqual([]);
      });
    });
  });

  describe("given the reader has asked for less motion", () => {
    describe("when it renders", () => {
      /** @scenario The loading screen stands still for a reader who asked for less motion */
      it("shows the logo and never starts the shader", () => {
        answerMotionPreference({ reduce: true });
        const getContext = vi
          .spyOn(HTMLCanvasElement.prototype, "getContext")
          .mockImplementation(() => null);

        renderWithDesignSystem(<LoadingScreen />);

        expect(screen.getByTestId("loading-screen-logo").querySelector("svg")).toBeTruthy();
        expect(screen.getByTestId("ambient-ground").getAttribute("data-live")).toBe("false");
        expect(getContext).not.toHaveBeenCalled();
      });
    });
  });
});
