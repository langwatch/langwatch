// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Castle } from "../../ui/castle.tsx";
import { arrive } from "../not-found-intro.ts";
import { sceneContent } from "../not-found-scenes.ts";

const PAGE = `
  <div data-docs-not-found="">
    <div data-nf-intro=""><svg viewBox="0 0 38 52"><path d="M0 0h38v52H0z" style="stroke: rgb(245, 107, 26)"></path></svg></div>
    <div data-nf-stage=""><div class="docs-nf-term"><svg data-nf-mark="" class="docs-nf-langy"></svg></div></div>
  </div>`;

const rect = ({ x, y, size }: { x: number; y: number; size: number }) =>
  ({
    left: x,
    top: y,
    width: size,
    height: size,
    right: x + size,
    bottom: y + size,
    x,
    y,
  }) as DOMRect;

type Call = { element: Element; keyframes: Keyframe[] };

/* jsdom has no Web Animations. The fake records each call and finishes at once; `onSettle`
   runs when the first animation (the stroke settling) is started. */
function stubMotion({ reduce, onSettle }: { reduce: boolean; onSettle?: () => void }) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
  const calls: Call[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      if (calls.length === 0) onSettle?.();
      calls.push({ element: this, keyframes });
      return { finished: Promise.resolve() };
    },
  });
  return calls;
}

describe("when the 404 island has picked the scene", () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = PAGE;
    root = document.querySelector("[data-docs-not-found]") as HTMLElement;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, "animate");
  });

  const showIntro = () => {
    const intro = root.querySelector("[data-nf-intro] svg") as SVGSVGElement;
    const rects = vi
      .spyOn(intro, "getClientRects")
      .mockReturnValue([rect({ x: 0, y: 0, size: 74 })] as never);
    vi.spyOn(intro, "getBoundingClientRect").mockReturnValue(rect({ x: 100, y: 300, size: 74 }));
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(rect({ x: 0, y: 0, size: 1000 }));
    const target = root.querySelector("[data-nf-stage] [data-nf-mark]") as Element;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect({ x: 40, y: 200, size: 30 }));
    return { target, hide: () => rects.mockReturnValue([] as never) };
  };

  /** @scenario "Draw the mark until the scene is chosen" */
  it("flies a filled copy of the mark onto the scene's own mark, then removes it", async () => {
    const calls = stubMotion({ reduce: false });
    const { target } = showIntro();
    const appended = vi.spyOn(root, "append");
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(true);
    const ghost = appended.mock.calls[0]?.[0] as SVGSVGElement;
    expect(ghost.querySelector("path")?.style.fill).toBe("rgb(245, 107, 26)");
    expect(ghost.isConnected).toBe(false);
    expect(calls.some((call) => call.element === target)).toBe(true);
    /* A 74px mark at (100, 300) lands centred on a 30px mark at (40, 200). */
    const flight = calls.find((call) => call.element === ghost && call.keyframes[1]?.transform);
    expect(flight?.keyframes[1]?.transform).toBe(`translate(-60px, -100px) scale(${30 / 74})`);
  });

  /** @scenario "Draw the mark until the scene is chosen" */
  it("shows the scene without a flight when the reader prefers reduced motion", async () => {
    stubMotion({ reduce: true });
    showIntro();
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(false);
  });

  /** @scenario "Draw the mark until the scene is chosen" */
  it("shows the scene without a flight when the intro has no box on screen", async () => {
    stubMotion({ reduce: false });
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(false);
  });

  /** @scenario "Draw the mark until the scene is chosen" */
  it("shows the scene without a flight when the fallback hides the intro mid-settle", async () => {
    const { hide } = showIntro();
    stubMotion({ reduce: false, onSettle: hide });
    const appended = vi.spyOn(root, "append");
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(false);
    expect(appended).not.toHaveBeenCalled();
  });
});

describe("when a scene is built for a missing address", () => {
  const input = { shown: "/missing", host: "langwatch.ai", pages: [], query: "missing" };

  /** @scenario "Draw the mark until the scene is chosen" */
  it("gives the terminal, the trace and the castle a mark to fly to", () => {
    for (const scene of ["engineering", "product"] as const)
      expect(sceneContent({ scene, input })?.querySelector("[data-nf-mark]"), scene).not.toBeNull();
    expect(renderToStaticMarkup(<Castle />)).toContain("data-nf-mark");
  });
});
