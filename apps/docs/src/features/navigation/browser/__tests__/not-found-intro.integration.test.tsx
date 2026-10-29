// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { arrive } from "../not-found-intro.ts";

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

function stubMotion({ reduce }: { reduce: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce") }));
  const animated: Element[] = [];
  Element.prototype.animate = function (this: Element) {
    animated.push(this);
    return { finished: Promise.resolve() } as unknown as Animation;
  };
  return animated;
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
  });

  const onScreen = () => {
    const intro = root.querySelector("[data-nf-intro] svg") as SVGSVGElement;
    vi.spyOn(intro, "getClientRects").mockReturnValue([rect({ x: 0, y: 0, size: 74 })] as never);
    vi.spyOn(intro, "getBoundingClientRect").mockReturnValue(rect({ x: 100, y: 300, size: 74 }));
    const target = root.querySelector("[data-nf-stage] [data-nf-mark]") as Element;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect({ x: 40, y: 200, size: 30 }));
    return { target };
  };

  /** @scenario "Draw the mark until the scene is chosen" */
  it("flies a filled copy of the mark to the scene's own mark, then removes it", async () => {
    const animated = stubMotion({ reduce: false });
    const { target } = onScreen();
    const appended = vi.spyOn(root, "append");
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(true);
    const ghost = appended.mock.calls[0]?.[0] as SVGSVGElement;
    expect(ghost.querySelector("path")?.style.fill).toBe("rgb(245, 107, 26)");
    expect(ghost.isConnected).toBe(false);
    expect(animated).toContain(target);
  });

  /** @scenario "Draw the mark until the scene is chosen" */
  it("shows the scene without a flight when the reader prefers reduced motion", async () => {
    stubMotion({ reduce: true });
    onScreen();
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(false);
  });

  /** @scenario "Draw the mark until the scene is chosen" */
  it("shows the scene without a flight once the castle has already replaced the intro", async () => {
    stubMotion({ reduce: false });
    await arrive({ root });
    expect(root.hasAttribute("data-ready")).toBe(true);
    expect(root.hasAttribute("data-flight")).toBe(false);
  });
});
