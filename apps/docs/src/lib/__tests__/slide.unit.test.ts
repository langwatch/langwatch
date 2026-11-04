// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { slide } from "../slide.ts";

type Keyframe = Record<string, string | number>;

function fakePanel({ running = false }: { running?: boolean } = {}) {
  const calls: { frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const animation = { id: "docs-slide", cancel: vi.fn(), onfinish: null as null | (() => void) };
  const panel = document.createElement("div");
  panel.hidden = true;
  Object.defineProperties(panel, {
    offsetHeight: { value: 40 },
    scrollHeight: { value: 120 },
    getAnimations: { value: () => (running ? [animation] : []) },
    animate: {
      value: (frames: Keyframe[], options: KeyframeAnimationOptions) => {
        calls.push({ frames, options });
        return animation;
      },
    },
  });
  return { panel, calls, animation };
}

function prefersMotion({ reduce }: { reduce: boolean }) {
  vi.stubGlobal("matchMedia", () => ({ matches: !reduce }));
  vi.stubGlobal("getComputedStyle", () => ({ opacity: "0.5" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("slide", () => {
  /** @scenario "Open and close every disclosure with a short height and fade" */
  it("grows an opening panel from nothing and fades it in over 200ms", () => {
    prefersMotion({ reduce: false });
    const { panel, calls, animation } = fakePanel();
    slide({ panel, open: true });
    expect(panel.hidden).toBe(false);
    expect(calls[0]?.frames).toEqual([
      { height: "0px", opacity: 0, overflow: "hidden" },
      { height: "120px", opacity: 1, overflow: "hidden" },
    ]);
    expect(calls[0]?.options.duration).toBe(200);
    animation.onfinish?.();
    expect(panel.hidden).toBe(false);
  });

  /** @scenario "Open and close every disclosure with a short height and fade" */
  it("shrinks a closing panel and hides it once the animation ends", () => {
    prefersMotion({ reduce: false });
    const { panel, calls, animation } = fakePanel();
    panel.hidden = false;
    slide({ panel, open: false });
    expect(calls[0]?.frames.at(-1)).toEqual({ height: "0px", opacity: 0, overflow: "hidden" });
    expect(panel.hidden).toBe(false);
    animation.onfinish?.();
    expect(panel.hidden).toBe(true);
  });

  /** @scenario "Open and close every disclosure with a short height and fade" */
  it("reverses from the panel's current height", () => {
    prefersMotion({ reduce: false });
    const { panel, calls } = fakePanel({ running: true });
    slide({ panel, open: false });
    expect(calls[0]?.frames[0]).toEqual({ height: "40px", opacity: "0.5", overflow: "hidden" });
  });

  /** @scenario "Open and close every disclosure with a short height and fade" */
  it("opens and closes at once for reduced motion", () => {
    prefersMotion({ reduce: true });
    const { panel, calls } = fakePanel();
    slide({ panel, open: true });
    expect(panel.hidden).toBe(false);
    slide({ panel, open: false });
    expect(panel.hidden).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
