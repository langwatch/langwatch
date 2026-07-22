/**
 * @vitest-environment jsdom
 *
 * The loading screen's way out.
 *
 * Every caller early-returns this screen, so React deletes it the instant
 * loading ends and a motion `exit` never runs — there is no `AnimatePresence`
 * holding it in the tree. The screen therefore leaves a copy of itself pinned
 * over the page and dissolves that, which is what makes the app look revealed
 * from underneath rather than swapped in.
 *
 * These pin the parts that can actually break: that a ghost appears at all,
 * that it can never swallow a click from the live page beneath it, that it
 * always cleans itself up, and that it stays away when the reader asked for
 * less motion.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "../LoadingScreen";

/** The running fades, so a test can finish or cancel them by hand. */
interface FakeAnimation {
  onfinish: (() => void) | null;
  oncancel: (() => void) | null;
}
let animations: FakeAnimation[] = [];

const setReducedMotion = (reduce: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("reduce"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
};

const ghost = () =>
  document.body.querySelector("[data-loading-screen-ghost]") as HTMLElement | null;

const renderScreen = () =>
  render(<LoadingScreen />, {
    wrapper: ({ children }) => (
      <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
    ),
  });

describe("the loading screen leaving", () => {
  beforeEach(() => {
    animations = [];
    setReducedMotion(false);
    // jsdom implements no Web Animations API; the component checks for it, so
    // the stub is what puts this suite on the real path rather than the guard.
    Object.defineProperty(Element.prototype, "animate", {
      writable: true,
      configurable: true,
      value: function () {
        const animation: FakeAnimation = { onfinish: null, oncancel: null };
        animations.push(animation);
        return animation;
      },
    });
  });

  afterEach(() => {
    cleanup();
    document.body.querySelectorAll("[data-loading-screen-ghost]").forEach((n) => n.remove());
    vi.restoreAllMocks();
  });

  describe("given the screen is on the page", () => {
    describe("when loading ends and it is unmounted", () => {
      it("leaves a copy of itself over the page to dissolve", () => {
        const view = renderScreen();
        expect(ghost()).toBeNull();

        view.unmount();

        const left = ghost();
        expect(left, "a ghost is left behind to fade").toBeTruthy();
        expect(left!.style.position).toBe("fixed");
      });

      it("never takes a click from the live page underneath it", () => {
        const view = renderScreen();
        view.unmount();

        const left = ghost()!;
        expect(left.style.pointerEvents).toBe("none");
        expect(left.getAttribute("aria-hidden")).toBe("true");
      });

      it("takes itself off the page once the fade finishes", () => {
        const view = renderScreen();
        view.unmount();
        expect(ghost()).toBeTruthy();

        animations.forEach((animation) => animation.onfinish?.());

        expect(ghost(), "the ghost must never outlive its fade").toBeNull();
      });

      it("takes itself off the page even if the fade is cancelled", () => {
        // A tab backgrounded mid-fade can leave the animation unfinished; a
        // ghost stuck at full opacity would cover the whole app.
        const view = renderScreen();
        view.unmount();

        animations.forEach((animation) => animation.oncancel?.());

        expect(ghost()).toBeNull();
      });
    });
  });

  describe("given the reader asked for reduced motion", () => {
    describe("when the screen is unmounted", () => {
      it("goes straight away, with nothing left fading", () => {
        setReducedMotion(true);
        const view = renderScreen();

        view.unmount();

        expect(ghost()).toBeNull();
      });
    });
  });
});
