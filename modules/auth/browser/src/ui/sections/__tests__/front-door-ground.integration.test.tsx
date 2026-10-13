/**
 * @vitest-environment jsdom
 * A door asked to hold still draws the still colour field and never asks the
 * machine for a graphics context. Spec: specs/identity/signin-signup-screens.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { publicEnvRef } = vi.hoisted(() => ({
  publicEnvRef: { current: { IS_SAAS: false } as Record<string, unknown> },
}));

vi.mock("../../../behavior/use-public-env.ts", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "../../elements/auth-card.tsx";
import { FrontDoorShell } from "../front-door-shell.tsx";

const askForLessMotion = () => {
  // A fresh `matchMedia` identity: `useReducedMotion` caches against the function.
  window.matchMedia = vi.fn((query: string): MediaQueryList => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("given less motion has been asked for", () => {
  describe("when I arrive at the sign-in screen", () => {
    /** @scenario A door asked to hold still never warms up a graphics engine */
    it("draws the still ground and never asks for a graphics context", () => {
      askForLessMotion();
      const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");

      renderWithDesignSystem(
        <FrontDoorShell>
          <AuthCard title="Log in to LangWatch">
            <input aria-label="Email" />
          </AuthCard>
        </FrontDoorShell>,
      );

      const ground = screen.getByTestId("ambient-ground");
      expect(ground.getAttribute("data-live")).toBe("false");
      expect(ground.querySelector(".lw-ambient-ground-static")).toBeTruthy();
      expect(ground.querySelector("canvas")).toBeNull();
      expect(getContext).not.toHaveBeenCalled();
    });
  });
});
