/**
 * @vitest-environment jsdom
 *
 * The entrance: the mark the loading screen was showing walks into the card.
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
import { FrontDoorShell } from "../FrontDoorShell";
import { _resetLogoHandoffForTests } from "../LogoHandoff";

/**
 * jsdom implements no Web Animations API, so the flight is stubbed: what the
 * component decides is testable, what the compositor does is not.
 */
interface FakeAnimation {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}

const animations: FakeAnimation[] = [];
const animate = vi.fn(() => {
  const animation: FakeAnimation = { onfinish: null, oncancel: null };
  animations.push(animation);
  return animation;
});

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
    animations.length = 0;
    animate.mockClear();
    document.body.className = "";
    setReducedMotion(false);
    (HTMLElement.prototype as unknown as { animate: unknown }).animate =
      animate;
  });

  afterEach(() => cleanup());

  describe("when the page loads", () => {
    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("flies the mark into the card's slot and holds the card's own back", async () => {
      const { container } = renderFrontDoor();

      expect(await screen.findByTestId("logo-handoff")).toBeTruthy();
      expect(animate).toHaveBeenCalledTimes(1);
      expect(
        container
          .querySelector("[data-auth-card-logo]")
          ?.classList.contains("lw-front-door-logo-waiting"),
      ).toBe(true);
      expect(document.body.classList.contains("lw-front-door-enter")).toBe(
        true,
      );
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("leaves the field live and typeable while the mark is still moving", async () => {
      renderFrontDoor();
      await screen.findByTestId("logo-handoff");

      const field = screen.getByLabelText("Email");
      expect(field).toBeTruthy();
      expect(field.hasAttribute("disabled")).toBe(false);
      // The overlay cannot take a click from the card underneath it.
      expect(screen.getByTestId("logo-handoff").className).toContain(
        "lw-front-door-handoff",
      );
    });

    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("plays once for the page, not once per screen", async () => {
      renderFrontDoor();
      await screen.findByTestId("logo-handoff");
      cleanup();

      renderFrontDoor();

      await waitFor(() => {
        expect(screen.queryByTestId("logo-handoff")).toBeNull();
      });
      expect(animate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when less motion has been asked for", () => {
    /** @scenario The entrance plays once, and never in front of a keystroke */
    it("places the card, animating nothing at all", async () => {
      setReducedMotion(true);

      const { container } = renderFrontDoor();

      await waitFor(() => {
        expect(screen.queryByTestId("logo-handoff")).toBeNull();
      });
      expect(animate).not.toHaveBeenCalled();
      expect(
        container
          .querySelector("[data-auth-card-logo]")
          ?.classList.contains("lw-front-door-logo-waiting"),
      ).toBe(false);
      expect(document.body.classList.contains("lw-front-door-enter")).toBe(
        false,
      );
    });
  });
});
