/**
 * @vitest-environment jsdom
 *
 * The entrance: the card settles into place when the auth screens first paints.
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

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "~/components/auth/AuthCard";
import { _resetEntranceForTests } from "../../logic/entrance";
import { AuthShell } from "../AuthShell";
import { _resetLogoHandoffForTests } from "../LogoHandoff";

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

const renderAuthScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AuthShell>
        <AuthCard title="Log in to LangWatch">
          <input aria-label="Email" />
        </AuthCard>
      </AuthShell>
    </ChakraProvider>,
  );

describe("given the auth screens painting for the first time", () => {
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
        renderAuthScreen();

        expect(document.body.classList.contains("lw-auth-enter")).toBe(true);

        vi.runAllTimers();

        expect(document.body.classList.contains("lw-auth-enter")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("leaves the field live and typeable while the card is still settling", () => {
      renderAuthScreen();

      expect(document.body.classList.contains("lw-auth-enter")).toBe(true);
      const field = screen.getByLabelText("Email");
      expect(field).toBeTruthy();
      expect(field.hasAttribute("disabled")).toBe(false);
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("plays once for the page, not once per screen", async () => {
      renderAuthScreen();
      expect(document.body.classList.contains("lw-auth-enter")).toBe(true);
      cleanup();

      renderAuthScreen();

      await waitFor(() => {
        expect(document.body.classList.contains("lw-auth-enter")).toBe(false);
      });
    });
  });

  describe("when less motion has been asked for", () => {
    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("places the card, animating nothing at all", () => {
      setReducedMotion(true);

      renderAuthScreen();

      expect(document.body.classList.contains("lw-auth-enter")).toBe(false);
      expect(screen.getByLabelText("Email")).toBeTruthy();
    });
  });
});
