/**
 * @vitest-environment jsdom
 *
 * Spec: specs/langy/langy-context-awareness.feature
 *   "Everything armed twinkles rather than pulsing in formation"
 *   "Things near my pointer light up quietly"
 *
 * The armed mode is only real if the page can SHOW it: arming must put the
 * visual marker (the `langy-target` ring class and its state attribute) onto
 * every registered target, and disarming must take it off again. The user
 * report behind this file was exactly "pressing # / holding Shift highlights
 * nothing" — so the render chain from the arm gesture to the element's own
 * attributes is what these tests pin.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangyContextTarget } from "../langy-context-target";
import { LangyContextTargetLayer } from "../langy-context-target-layer";
import { useLangyContextTargetStore } from "../../../behavior/langy-context-target.store";
import { useLangyStore } from "../../../behavior/langy.store";

function press(key: string, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyContextTargetLayer />
      <LangyContextTarget target={{ id: "trace:t-1", kind: "trace", label: "Trace t-1" }}>
        <div data-testid="trace-card">a trace row</div>
      </LangyContextTarget>
    </ChakraProvider>,
  );
}

describe("armed context targets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLangyContextTargetStore.getState().reset();
    useLangyStore.setState({ isOpen: false });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a page with a registered target", () => {
    describe("when the user presses #", () => {
      it("puts the lit ring marker on the target", () => {
        renderPage();

        press("#");

        const card = screen.getByTestId("trace-card");
        expect(card.className).toContain("langy-target");
        expect(card.getAttribute("data-langy-target-state")).toBe("near");
      });

      it("shows the mode hint so the user knows the page is armed", () => {
        renderPage();

        press("#");

        // `isConnected`, not `toBeInTheDocument`: this package carries no
        // jest-dom, so that matcher was an unknown Chai property and the
        // assertion threw however the hint rendered. It checks the same thing
        // — attached to the document — and the hint is portalled to
        // `document.body`, so being attached is the part worth stating.
        expect(screen.getByTestId("langy-armed-hint").isConnected).toBe(true);
      });
    });

    describe("when the user latches the mode with #", () => {
      it("puts the lit ring marker on the target", () => {
        renderPage();

        press("#");

        const card = screen.getByTestId("trace-card");
        expect(card.className).toContain("langy-target");
        expect(card.getAttribute("data-langy-target-state")).toBe("near");
      });
    });

    describe("when the user leaves the mode with Escape", () => {
      it("takes the ring marker off again", () => {
        renderPage();
        press("#");
        expect(screen.getByTestId("trace-card").getAttribute("data-langy-target-state")).toBe(
          "near",
        );

        press("Escape");

        const card = screen.getByTestId("trace-card");
        expect(card.className).not.toContain("langy-target");
        expect(card.getAttribute("data-langy-target-state")).toBeNull();
      });
    });
  });
});
