/**
 * @vitest-environment jsdom
 *
 * The entrance: the card settles into place when the front door first paints.
 * What is pinned here is not the motion — it is the three rules around it:
 * once per page load, nothing at all under reduced motion, and never in front
 * of a keystroke.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publicEnvRef } = vi.hoisted(() => ({
  publicEnvRef: { current: { IS_SAAS: false } as Record<string, unknown> },
}));

vi.mock("../../../behavior/use-public-env", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "../../elements/auth-card";
import { _resetEntranceForTests } from "../../../model/entrance";
import { FrontDoorShell } from "../front-door-shell";
import { _resetLogoHandoffForTests } from "../logo-handoff";

const setReducedMotion = (reduce: boolean) => {
  // A fresh `matchMedia` identity on purpose: `useReducedMotion` caches its
  // MediaQueryList against the function it was created from.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const renderFrontDoor = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FrontDoorShell>
        <AuthCard title="Log in to LangWatch">
          <input aria-label="Email" />
        </AuthCard>
      </FrontDoorShell>
    </ChakraProvider>,
  );

describe("given the front door painting for the first time", () => {
  beforeEach(() => {
    _resetLogoHandoffForTests();
    _resetEntranceForTests();
    document.body.className = "";
    setReducedMotion(false);
  });

  afterEach(() => cleanup());

  describe("when the page loads", () => {
    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("marks the body for the settle, and takes the mark off once it has played", async () => {
      vi.useFakeTimers();
      try {
        renderFrontDoor();

        expect(document.body.classList.contains("lw-front-door-enter")).toBe(true);

        vi.runAllTimers();

        expect(document.body.classList.contains("lw-front-door-enter")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("leaves the field live and typeable while the card is still settling", () => {
      renderFrontDoor();

      expect(document.body.classList.contains("lw-front-door-enter")).toBe(true);
      const field = screen.getByLabelText("Email");
      expect(field).toBeTruthy();
      expect(field.hasAttribute("disabled")).toBe(false);
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("plays once for the page, not once per screen", async () => {
      renderFrontDoor();
      expect(document.body.classList.contains("lw-front-door-enter")).toBe(true);
      cleanup();

      renderFrontDoor();

      await waitFor(() => {
        expect(document.body.classList.contains("lw-front-door-enter")).toBe(false);
      });
    });
  });

  describe("when less motion has been asked for", () => {
    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("places the card, animating nothing at all", () => {
      setReducedMotion(true);

      renderFrontDoor();

      expect(document.body.classList.contains("lw-front-door-enter")).toBe(false);
      expect(screen.getByLabelText("Email")).toBeTruthy();
    });
  });
});
