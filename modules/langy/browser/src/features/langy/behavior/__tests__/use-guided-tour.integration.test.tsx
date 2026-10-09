// @vitest-environment jsdom

import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { GuidedTourStateToken } from "@langwatch/onboarding-client";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { useGuidedTour } from "../use-guided-tour.ts";

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("useGuidedTour", () => {
  describe("given onboarding lends its guided tour state by token", () => {
    /** @scenario Langy's tour card reads onboarding's tour state through its client token */
    it("reads onboarding's answer to whether a tour is running", () => {
      const replay = vi.fn();
      declarations.current = uiDeclarations([
        {
          name: "onboarding",
          installation: {
            capabilities: {},
            lends: [
              {
                token: GuidedTourStateToken,
                value: { useRunning: () => true, useReplay: () => replay },
              },
            ],
          },
        },
      ]);

      const { result } = renderHook(() => {
        const tour = useGuidedTour();
        return { running: tour.useRunning(), replay: tour.useReplay() };
      });

      expect(result.current.running).toBe(true);
      result.current.replay({ path: "observability" });
      expect(replay).toHaveBeenCalledWith({ path: "observability" });
    });
  });

  describe("given no installed module lends the guided tour state token", () => {
    /** @scenario An uninstalled onboarding leaves Langy's tour card idle */
    it("reports no tour running, and a replay does nothing", () => {
      declarations.current = uiDeclarations([]);

      const { result } = renderHook(() => {
        const tour = useGuidedTour();
        return { running: tour.useRunning(), replay: tour.useReplay() };
      });

      expect(result.current.running).toBe(false);
      expect(() => result.current.replay({ path: "observability" })).not.toThrow();
    });
  });
});
