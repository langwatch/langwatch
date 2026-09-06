/**
 * @vitest-environment jsdom
 *
 * Arming is a MODE, and a mode has to be hard to enter by accident and trivial
 * to leave. These are the ways it could go wrong:
 *   - `#` is a character. Typing it into the composer or a search box must type
 *     it, not light up the page.
 *   - Escape must only be swallowed when it actually disarmed something.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangyContextTargetLayer } from "../components/LangyContextTargetLayer";
import { useLangyContextArming } from "../hooks/useLangyContextArming";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";

function Host() {
  useLangyContextArming();
  return null;
}

const armSource = () => useLangyContextTargetStore.getState().armSource;

/** A keydown as the browser delivers it — on the focused element, bubbling. */
function press(key: string, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("useLangyContextArming", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLangyContextTargetStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given the page is idle", () => {
    describe("when the user presses #", () => {
      it("latches the mode on", () => {
        render(<Host />);

        press("#");

        expect(armSource()).toBe("key");
      });

      it("stays on across other keys — it is a latch, not a hold", () => {
        render(<Host />);

        press("#");
        press("j");

        expect(armSource()).toBe("key");
      });
    });

    describe("when the user types # into a text field", () => {
      it("leaves the page alone, because # is a character people type", () => {
        render(<Host />);
        const input = document.createElement("input");
        document.body.appendChild(input);

        press("#", input);

        expect(armSource()).toBeNull();
        input.remove();
      });
    });
  });

  describe("given the mode was latched with #", () => {
    beforeEach(() => {
      render(<Host />);
      press("#");
    });

    describe("when the user presses # again", () => {
      it("puts it away", () => {
        press("#");

        expect(armSource()).toBeNull();
      });
    });

    describe("when the user presses Escape", () => {
      it("puts it away", () => {
        press("Escape");

        expect(armSource()).toBeNull();
      });
    });
  });

  describe("given the page is disarmed", () => {
    describe("when the user presses Escape", () => {
      it("lets it through, so it still closes whatever it was meant for", () => {
        render(<Host />);
        const event = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        });

        act(() => {
          document.body.dispatchEvent(event);
        });

        expect(event.defaultPrevented).toBe(false);
      });
    });
  });
});

/**
 * The gesture has to work from where the user actually is.
 *
 * The arming listener lived inside a subtree the layer only rendered while the
 * Langy panel was OPEN, so pressing `#` anywhere else did nothing whatsoever —
 * no highlight, no hint, no error. The peek made that the common case rather
 * than the edge one: a minimised panel reads as closed, which is how Langy sits
 * most of the time.
 *
 * Mounted through the REAL layer, not the hook: mounting the hook directly is
 * exactly what let the bug through, because the hook was never the broken part.
 */
/** The layer paints real chrome once armed, so it needs the design system. */
function renderLayer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyContextTargetLayer />
    </ChakraProvider>,
  );
}

describe("LangyContextTargetLayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLangyContextTargetStore.getState().reset();
    useLangyStore.setState({ isOpen: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    useLangyStore.setState({ isOpen: false });
  });

  describe("given the Langy panel is closed", () => {
    describe("when the user presses #", () => {
      it("still latches the mode on", () => {
        renderLayer();

        press("#");

        expect(armSource()).toBe("key");
      });
    });
  });
});
