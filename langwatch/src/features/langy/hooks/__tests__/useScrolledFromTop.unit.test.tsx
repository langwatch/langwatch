// @vitest-environment jsdom
/**
 * The conversation column's scroll-shadow source of truth: the top mask fade
 * may only dim content that is actually scrolled off above, never the first
 * message at rest. jsdom has no layout, so `scrollTop` is set directly and the
 * scroll event dispatched by hand; the listener and state are the real thing.
 *
 * Spec: specs/langy/langy-panel-layout.feature
 * ("The conversation fades at the top only once messages are scrolled off above")
 */
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";
import { useScrolledFromTop } from "../useScrolledFromTop";

function makeScroller() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

describe("useScrolledFromTop", () => {
  describe("when the scroller sits at the very top", () => {
    it("reports nothing scrolled off above", () => {
      const el = makeScroller();
      const ref: RefObject<HTMLElement | null> = { current: el };

      const { result } = renderHook(() => useScrolledFromTop(ref));

      expect(result.current).toBe(false);
    });

    it("treats sub-pixel residue at the top as still at the top", () => {
      const el = makeScroller();
      const ref: RefObject<HTMLElement | null> = { current: el };
      const { result } = renderHook(() => useScrolledFromTop(ref));

      act(() => scrollTo(el, 0.5));

      expect(result.current).toBe(false);
    });
  });

  describe("when content is scrolled off above", () => {
    it("flips true past the top edge and back false on return", () => {
      const el = makeScroller();
      const ref: RefObject<HTMLElement | null> = { current: el };
      const { result } = renderHook(() => useScrolledFromTop(ref));

      act(() => scrollTo(el, 120));
      expect(result.current).toBe(true);

      act(() => scrollTo(el, 0));
      expect(result.current).toBe(false);
    });

    it("reads an already-scrolled element on mount", () => {
      const el = makeScroller();
      el.scrollTop = 300;
      const ref: RefObject<HTMLElement | null> = { current: el };

      const { result } = renderHook(() => useScrolledFromTop(ref));

      expect(result.current).toBe(true);
    });
  });

  describe("when the scroller remounts behind the same ref", () => {
    it("follows the new element instead of the dead one", () => {
      const first = makeScroller();
      const ref: RefObject<HTMLElement | null> = { current: first };
      const { result, rerender } = renderHook(() => useScrolledFromTop(ref));

      act(() => scrollTo(first, 200));
      expect(result.current).toBe(true);

      // The recents list takes over the panel body: the scroller unmounts and
      // a fresh element lands in the ref on the way back, starting at the top.
      first.remove();
      ref.current = makeScroller();
      rerender();
      expect(result.current).toBe(false);

      // The dead element's events no longer reach the hook.
      act(() => scrollTo(first, 400));
      expect(result.current).toBe(false);

      // The live one's do.
      act(() => {
        if (ref.current) scrollTo(ref.current, 80);
      });
      expect(result.current).toBe(true);
    });
  });
});
