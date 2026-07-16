import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStickToBottom } from "../hooks/useLangyStickToBottom";

// Motion ON — so the tests drive the real default path (smooth scrollIntoView),
// not the reduced-motion fallback.
vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: () => false,
}));

/**
 * jsdom has no layout engine: `scrollHeight` and `clientHeight` are hard 0 and
 * `scrollIntoView` does not exist. So we drive geometry by hand — a fake
 * viewport of VIEWPORT_H over a content box we grow ourselves — and let the
 * hook do exactly what it would do in a browser: read the numbers, decide
 * whether it holds the pin, and move `scrollTop`.
 *
 * This is the point of the test. The bug being pinned here is NOT "does the
 * browser scroll" — it is "does the hook still follow content that grew without
 * `messages` changing" (Stream B tokens, turn signals, cards), and "does it
 * stop following the moment the user scrolls up".
 */
const VIEWPORT_H = 100;

let resizeCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(cb: () => void) {
    resizeCallback = cb;
  }
  observe() {}
  disconnect() {
    resizeCallback = null;
  }
}

/** Give an element a fake, controllable box. */
function fakeBox(el: HTMLElement, { scrollHeight }: { scrollHeight: number }) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: VIEWPORT_H,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
}

/**
 * jsdom has no `scrollIntoView`. Stand in for what a browser does when the hook
 * asks to bring the bottom sentinel into view: park the scroller at its live
 * edge, and emit the scroll event that a real scroll emits — which is precisely
 * the event that used to release the pin mid-glide.
 */
function installScrollIntoView(scroller: HTMLElement) {
  Element.prototype.scrollIntoView = function scrollIntoViewStub() {
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event("scroll"));
  };
}

function Harness() {
  const { scrollRef, contentRef, endRef, isPinned, canScroll, jumpToLatest } =
    useLangyStickToBottom();
  const [height, setHeight] = useState(80);

  return (
    <div>
      <div data-testid="scroller" ref={scrollRef}>
        <div data-testid="content" ref={contentRef} style={{ height }}>
          <div ref={endRef} />
        </div>
      </div>
      <span data-testid="pinned">{String(isPinned)}</span>
      <span data-testid="can-scroll">{String(canScroll)}</span>
      <button onClick={jumpToLatest}>jump</button>
      {/* Stands in for "a token arrived" / "a card rendered" — content grows
          without anything the old effect's dep list would have noticed. */}
      <button onClick={() => setHeight((h) => h + 200)}>grow</button>
    </div>
  );
}

/** Grow the content and fire the ResizeObserver, as a browser would. */
function grow(scroller: HTMLElement, to: number) {
  act(() => {
    fakeBox(scroller, { scrollHeight: to });
    resizeCallback?.();
  });
}

/** Move the scroller the way a user's wheel/trackpad would. */
function userScrollTo(scroller: HTMLElement, top: number) {
  act(() => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

function setup() {
  render(<Harness />);
  const scroller = screen.getByTestId("scroller");
  installScrollIntoView(scroller);
  return {
    scroller,
    pinned: () => screen.getByTestId("pinned").textContent,
    canScroll: () => screen.getByTestId("can-scroll").textContent,
  };
}

describe("given the Langy message column follows a stream", () => {
  beforeEach(() => {
    resizeCallback = null;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // Run the hook's coalescing frame synchronously.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
  });

  describe("when content grows while the viewport is at the bottom", () => {
    it("follows the live edge, though nothing in `messages` changed", () => {
      const { scroller, pinned } = setup();

      grow(scroller, 300);

      expect(scroller.scrollTop).toBe(300);
      expect(pinned()).toBe("true");
    });

    it("keeps following each further growth", () => {
      const { scroller } = setup();

      grow(scroller, 300);
      grow(scroller, 700);

      expect(scroller.scrollTop).toBe(700);
    });
  });

  describe("when the user has scrolled up to read", () => {
    it("releases the pin", () => {
      const { scroller, pinned } = setup();
      grow(scroller, 500);

      userScrollTo(scroller, 100);

      expect(pinned()).toBe("false");
    });

    it("does NOT drag them back down when new content arrives", () => {
      const { scroller, pinned } = setup();
      grow(scroller, 500);
      userScrollTo(scroller, 100);

      grow(scroller, 900);

      expect(scroller.scrollTop).toBe(100);
      expect(pinned()).toBe("false");
    });

    it("offers the way back, because the content overflows", () => {
      const { scroller, canScroll } = setup();
      grow(scroller, 500);

      userScrollTo(scroller, 100);

      expect(canScroll()).toBe("true");
    });
  });

  describe("when the user scrolls back down to the bottom", () => {
    it("re-engages auto-follow", () => {
      const { scroller, pinned } = setup();
      grow(scroller, 500);
      userScrollTo(scroller, 100);
      expect(pinned()).toBe("false");

      // The live edge: scrollHeight 500 − viewport 100.
      userScrollTo(scroller, 400);
      expect(pinned()).toBe("true");

      grow(scroller, 800);
      expect(scroller.scrollTop).toBe(800);
    });
  });

  describe("when our own smooth scroll is mid-glide toward the bottom", () => {
    it("does not release the pin on its intermediate positions", () => {
      const { scroller, pinned } = setup();

      // A smooth scroll emits a scroll event per frame, and every frame before
      // the last one is "not at the bottom yet". Releasing on those would kill
      // auto-follow on the very animation that was honouring it — so only an
      // UPWARD move may release. Here the scroller is mid-glide: content is
      // 500 tall and we are passing 250 on the way down.
      act(() => {
        fakeBox(scroller, { scrollHeight: 500 });
      });
      userScrollTo(scroller, 250);

      expect(pinned()).toBe("true");
    });
  });
});
