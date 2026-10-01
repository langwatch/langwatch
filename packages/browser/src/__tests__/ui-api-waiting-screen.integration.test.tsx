/**
 * The waiting screen's ground, for a reader who asked for less motion.
 * @vitest-environment jsdom
 * Spec: specs/ui/api-boot-wait.feature
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiApiWaitingScreen } from "../ui-api-waiting-screen.tsx";

const realMatchMedia = window.matchMedia;

function prefersReducedMotion(): MediaQueryList {
  const list = new EventTarget();
  return Object.assign(list, {
    matches: true,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
}

beforeEach(() => {
  window.matchMedia = vi.fn(prefersReducedMotion);
});

afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

describe("given the reader has asked for less motion", () => {
  describe("when the waiting screen renders", () => {
    /** @scenario "The waiting screen stands still for a reader who asked for less motion" */
    it("shows only the static ground and never starts the shader", () => {
      // Spied so the test sees whether the WebGL probe was ever asked.
      const getContext = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockImplementation(() => null);

      const view = render(
        <UiApiWaitingScreen
          endpoint="http://localhost:5560/api/health"
          isDevelopment
          explaining={false}
        />,
      );

      const ground = view.getByTestId("ambient-ground");
      expect(ground.getAttribute("data-live")).toBe("false");
      expect(ground.querySelector(".lw-ambient-ground-static")).toBeTruthy();
      expect(ground.querySelector("canvas")).toBeNull();
      expect(getContext).not.toHaveBeenCalled();
    });
  });
});
