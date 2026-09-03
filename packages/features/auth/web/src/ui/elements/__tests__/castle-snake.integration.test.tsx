/**
 * @vitest-environment jsdom
 *
 * The castle Snake, checked for the only things that could hurt anybody: that
 * it cannot start by accident, cannot come between somebody and the form, and
 * gives everything back when it stops.
 *
 * The game's own rules are checked without a DOM in
 * `logic/__tests__/castleSnake.unit.test.ts`. jsdom has no 2D context, so no
 * frame is ever painted here — which is exactly the right level for these
 * scenarios, since none of them are about what the game looks like.
 *
 * Spec: specs/identity/front-door-castle-snake.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { publicEnvRef } = vi.hoisted(() => ({
  publicEnvRef: { current: { IS_SAAS: true } as Record<string, unknown> },
}));

vi.mock("../../../behavior/use-public-env", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

import { AuthCard } from "../auth-card";
import { FrontDoorShell } from "../../sections/front-door-shell";

const here = dirname(fileURLToPath(import.meta.url));
const castleSnakeSource = readFileSync(
  join(here, "..", "castle-snake.tsx"),
  "utf8",
);

const renderDoor = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FrontDoorShell
        headline="See what your agents are actually doing."
        headlineAccent="actually"
        tagline="Log in and pick up where you left off."
      >
        <AuthCard title="Log in to LangWatch">
          <input aria-label="Email" />
        </AuthCard>
      </FrontDoorShell>
    </ChakraProvider>,
  );

const castle = () => screen.getByTestId("front-door-panel-logo");
const game = () => screen.queryByTestId("castle-snake");

describe("given a hosted deployment with the front door enabled", () => {
  beforeEach(() => {
    publicEnvRef.current = { IS_SAAS: true };
  });

  afterEach(() => cleanup());

  describe("when I double-tap the LangWatch castle", () => {
    /** @scenario The castle opens on a double-tap and on nothing else */
    it("starts a game on the ground behind the card", () => {
      renderDoor();
      expect(game()).toBeNull();

      fireEvent.dblClick(castle());

      expect(game()).toBeTruthy();
      expect(screen.getByTestId("castle-snake-hud")).toHaveTextContent(
        /0 tokens/i,
      );
    });

    /** @scenario The castle opens on a double-tap and on nothing else */
    it("starts nothing on a single click", () => {
      renderDoor();

      fireEvent.click(castle());

      expect(game()).toBeNull();
    });

    /** @scenario The castle opens on a double-tap and on nothing else */
    it("starts nothing when the double-tap lands anywhere else", () => {
      renderDoor();

      fireEvent.dblClick(screen.getByTestId("front-door-headline"));
      fireEvent.dblClick(screen.getByLabelText("Email"));

      expect(game()).toBeNull();
    });
  });

  describe("when a game is running", () => {
    /** @scenario The game never comes between anybody and the card */
    it("keeps every pixel and every click the card had", () => {
      renderDoor();
      const card = screen.getByText("Log in to LangWatch");

      fireEvent.dblClick(castle());

      // Out of flow and deaf to the pointer. Those two together are the whole
      // safety argument: it cannot move the card and it cannot intercept it.
      expect(game()).toHaveStyle({
        position: "fixed",
        pointerEvents: "none",
      });
      expect(screen.getByTestId("front-door-card-column").contains(card)).toBe(
        true,
      );
      expect(screen.getByLabelText("Email")).toBeTruthy();
    });

    /** @scenario Escape puts it away and returns the keyboard */
    it("stops on Escape and leaves the page as it found it", () => {
      renderDoor();
      fireEvent.dblClick(castle());
      expect(game()).toBeTruthy();

      fireEvent.keyDown(window, { key: "Escape" });

      expect(game()).toBeNull();
      expect(screen.queryByTestId("castle-snake-hud")).toBeNull();
    });

    /** @scenario Escape puts it away and returns the keyboard */
    it("gives the arrow keys back the moment it stops", () => {
      renderDoor();
      fireEvent.dblClick(castle());

      // Borrowed while playing...
      const whilePlaying = fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(whilePlaying).toBe(false);

      fireEvent.keyDown(window, { key: "Escape" });

      // ...and handed straight back, so nothing on the page is left with an
      // arrow key that no longer moves a cursor.
      const afterStopping = fireEvent.keyDown(window, { key: "ArrowLeft" });
      expect(afterStopping).toBe(true);
    });

    /** @scenario The game never comes between anybody and the card */
    it("leaves typing alone", () => {
      renderDoor();
      fireEvent.dblClick(castle());

      // Only the four arrows and Escape are taken. A letter is not the
      // game's business even while it is running.
      expect(fireEvent.keyDown(window, { key: "a" })).toBe(true);
      expect(fireEvent.keyDown(window, { key: "Tab" })).toBe(true);
    });
  });

  describe("when less motion has been asked for", () => {
    /** @scenario A deliberately started game still plays under reduced motion */
    it("still plays, because somebody deliberately started it", () => {
      // A render cannot show this — jsdom paints no frames — but the thing
      // that would break it is somebody adding the gate, so the absence of
      // the gate is what gets pinned. `prefers-reduced-motion` asks not to be
      // moved AT; it does not ask a game to sit still.
      expect(castleSnakeSource).not.toContain("useReducedMotion");
      expect(castleSnakeSource).not.toContain("matchMedia");
      // And the reason is written down beside it, so the next person to read
      // this file finds an argument rather than an apparent oversight.
      expect(castleSnakeSource).toContain('Please do not "fix" this');
    });
  });
});
