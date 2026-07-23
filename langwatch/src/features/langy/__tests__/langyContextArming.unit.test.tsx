/**
 * @vitest-environment jsdom
 *
 * Arming is a MODE, and a mode has to be hard to enter by accident and trivial
 * to leave. These are the ways it could go wrong:
 *   - `#` is a character. Typing it into the composer or a search box must type
 *     it, not light up the page.
 *   - Shift is pressed constantly. Every capital letter must not flash the page.
 *   - Two gestures, one mode: a Shift keyup must not cancel a `#` latch.
 *   - A tab switch mid-hold must not leave the page armed forever.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyContextArming } from "../hooks/useLangyContextArming";
import { useLangyContextTargetStore } from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";
import { LangyContextTargetLayer } from "../components/LangyContextTargetLayer";

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

function release(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
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

    describe("when the user holds Shift", () => {
      it("arms only once the hold is deliberate", () => {
        render(<Host />);

        press("Shift");
        expect(armSource()).toBeNull();

        act(() => vi.advanceTimersByTime(400));

        expect(armSource()).toBe("hold");
      });

      it("disarms the moment it is released", () => {
        render(<Host />);
        press("Shift");
        act(() => vi.advanceTimersByTime(400));

        release("Shift");

        expect(armSource()).toBeNull();
      });

      it("arms even while a text field is focused — a bare Shift types nothing", () => {
        // The composer is the field you reach for this from: mid-message, you
        // hold Shift to point at the thing on the page you are about to ask
        // about. The `#` latch yields to typing; the Shift hold must not.
        render(<Host />);
        const input = document.createElement("input");
        document.body.appendChild(input);

        press("Shift", input);
        act(() => vi.advanceTimersByTime(400));

        expect(armSource()).toBe("hold");
        input.remove();
      });
    });

    describe("when the user types a capital letter", () => {
      it("never flashes the page — Shift and a letter is not a hold", () => {
        render(<Host />);

        press("Shift");
        press("A");
        act(() => vi.advanceTimersByTime(400));

        expect(armSource()).toBeNull();
      });
    });
  });

  describe("given the mode was latched with #", () => {
    beforeEach(() => {
      render(<Host />);
      press("#");
    });

    describe("when the user releases a Shift they happened to be holding", () => {
      it("keeps the latch — the keyup belongs to a different gesture", () => {
        release("Shift");

        expect(armSource()).toBe("key");
      });
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

  describe("given the window loses focus mid-hold", () => {
    it("disarms, because the keyup will never arrive", () => {
      render(<Host />);
      press("Shift");
      act(() => vi.advanceTimersByTime(400));
      expect(armSource()).toBe("hold");

      act(() => {
        window.dispatchEvent(new Event("blur"));
      });

      expect(armSource()).toBeNull();
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
 * Langy panel was OPEN, so holding Shift anywhere else did nothing whatsoever —
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
    describe("when the user holds Shift", () => {
      it("still arms the page", () => {
        renderLayer();

        press("Shift");
        act(() => {
          vi.advanceTimersByTime(400);
        });

        expect(armSource()).toBe("hold");
      });
    });

    describe("when the user presses #", () => {
      it("still latches the mode on", () => {
        renderLayer();

        press("#");

        expect(armSource()).toBe("key");
      });
    });
  });
});
