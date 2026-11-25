// @vitest-environment jsdom
/** The callable Drawer's translucent header and footer, behind one switch that is on by default. */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Drawer, DrawerGlassProvider } from "../src/components/overlays/drawer.tsx";
import { Text } from "../src/primitives.ts";
import { drawerGlassFooter, drawerGlassHeader } from "../src/system/drawer.recipe.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const resizeObservers: FakeResizeObserver[] = [];

class FakeResizeObserver {
  observed = new Set<Element>();
  disconnected = 0;
  constructor(private readonly callback: () => void) {
    resizeObservers.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
    this.disconnected += 1;
  }
  fire() {
    this.callback();
  }
}

beforeEach(() => {
  resizeObservers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** jsdom resolves no cascade layers, so read the rules a node's classes were given. */
function rulesOf(element: Element): string {
  const css = Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
  return Array.from(element.classList)
    .flatMap((name) => css.match(new RegExp(`\\.${name}[^{]*\\{[^}]*\\}`, "g")) ?? [])
    .join("");
}

function found(element: Element | null): HTMLElement {
  if (!(element instanceof HTMLElement)) throw new Error("expected the element in the document");
  return element;
}

function renderDrawer({
  glass,
  bodyScroll,
  withFooter = true,
}: {
  glass: boolean;
  bodyScroll?: "frame" | "content";
  withFooter?: boolean;
}) {
  return renderWithDesignSystem(
    <DrawerGlassProvider value={glass}>
      <Drawer
        title="Production key"
        onClose={() => undefined}
        toolbar={<Text>Filters</Text>}
        bodyScroll={bodyScroll}
        footer={
          withFooter ? { primaryAction: { label: "Save", onClick: () => undefined } } : void 0
        }
        data-testid="key"
      >
        <Text>Body text</Text>
      </Drawer>
    </DrawerGlassProvider>,
  );
}

function parts() {
  return {
    body: found(screen.getByTestId("key-body")),
    header: document.querySelector<HTMLElement>("[data-chrome='header']"),
    footer: document.querySelector<HTMLElement>("[data-chrome='footer']"),
  };
}

function measure({
  body,
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  body: HTMLElement;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  Object.defineProperties(body, {
    scrollTop: { configurable: true, writable: true, value: scrollTop },
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  });
  fireEvent.scroll(body);
}

describe("the Drawer shape's glass switch", () => {
  /** @scenario "The translucent header and footer are on by default, approved after the screenshots" */
  it("draws the solid look when nobody switches the glass on", () => {
    renderDrawer({ glass: false });
    const { body, header, footer } = parts();

    expect(header).toBeNull();
    expect(footer).toBeNull();
    expect(body.style.getPropertyValue("--lw-drawer-top")).toBe("");
    expect(rulesOf(found(document.querySelector(".chakra-drawer__header")))).not.toContain(
      "backdrop-filter",
    );
    expect(resizeObservers).toHaveLength(0);
  });

  /** @scenario "The translucent header and footer are on by default, approved after the screenshots" */
  it("defaults to the glass look without any provider", () => {
    renderWithDesignSystem(
      <Drawer title="Key" onClose={() => undefined} data-testid="key">
        <Text>Body</Text>
      </Drawer>,
    );

    expect(document.querySelector("[data-chrome]")).not.toBeNull();
  });
});

describe("a glass drawer's layout", () => {
  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("keeps header, body and footer in order, with the glass material on the bands only", () => {
    renderDrawer({ glass: true });
    const { body, header, footer } = parts();

    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(header!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header!.contains(found(document.querySelector(".chakra-drawer__header")))).toBe(true);
    expect(header!.textContent).toContain("Filters");
    for (const band of [header!, footer!]) {
      const rules = rulesOf(band);
      expect(rules).toContain("position:absolute");
      expect(rules).toContain("--chakra-colors-bg-drawer-chrome");
      expect(rules).toContain("var(--lw-panel-alpha, 50%)");
      expect(rules).toContain("var(--lw-backdrop-blur, blur(12px))");
    }
    expect(rulesOf(body)).not.toContain("backdrop-filter");
    expect(rulesOf(found(document.querySelector("[data-part='content']")))).not.toContain(
      "backdrop-filter",
    );
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("sets the body's clearance from the measured band heights", () => {
    renderDrawer({ glass: true });
    const { body, header, footer } = parts();
    vi.spyOn(header!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 96));
    vi.spyOn(footer!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 64));

    act(() => {
      for (const observer of resizeObservers) observer.fire();
    });

    expect(body.style.getPropertyValue("--lw-drawer-top")).toBe("96px");
    expect(body.style.getPropertyValue("--lw-drawer-bottom")).toBe("64px");
    const rules = rulesOf(body);
    expect(rules).toContain(
      "padding-top:calc(var(--lw-drawer-top, 0px) + var(--chakra-spacing-4))",
    );
    expect(rules).toContain("scroll-padding-bottom:var(--lw-drawer-bottom, 0px)");
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("measures no footer band when the drawer has none", () => {
    renderDrawer({ glass: true, withFooter: false });
    const { body, footer } = parts();

    expect(footer).toBeNull();
    expect(body.style.getPropertyValue("--lw-drawer-bottom")).toBe("0px");
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("keeps the close control above the header band", () => {
    renderDrawer({ glass: true });

    expect(rulesOf(screen.getByRole("button", { name: /close/i }))).toContain("z-index:2");
  });

  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it("leaves a content-owned body with its flex siblings and static separators", () => {
    renderDrawer({ glass: true, bodyScroll: "content" });

    expect(document.querySelector("[data-chrome]")).toBeNull();
    expect(resizeObservers).toHaveLength(0);
    expect(rulesOf(found(document.querySelector(".chakra-drawer__footer")))).toContain(
      "border-top-width",
    );
  });
});

describe("a glass drawer's fallbacks", () => {
  /** @scenario "A glass drawer overlays its header band and footer on the one scrolling body" */
  it.each([
    { band: "header", styles: drawerGlassHeader },
    { band: "footer", styles: drawerGlassFooter },
  ])("gives the $band an opaque or static answer where glass cannot be read", ({ styles }) => {
    expect(styles["@supports not (backdrop-filter: blur(1px))"]).toMatchObject({
      background: "bg.drawer.chrome",
    });
    expect(styles["@media (prefers-reduced-transparency: reduce)"]).toMatchObject({
      background: "bg.drawer.chrome",
      backdropFilter: "none",
    });
    expect(styles["@media (forced-colors: active)"]).toMatchObject({
      backdropFilter: "none",
      borderColor: "CanvasText",
    });
    expect(styles._motionReduce).toEqual({ transition: "none" });
  });
});

describe("a glass drawer's edges", () => {
  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("turns each edge on only while content waits beyond it", () => {
    renderDrawer({ glass: true });
    const { body, header, footer } = parts();

    measure({ body, scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
    expect([header!.dataset.edge, footer!.dataset.edge]).toEqual(["off", "on"]);

    measure({ body, scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });
    expect([header!.dataset.edge, footer!.dataset.edge]).toEqual(["on", "on"]);

    measure({ body, scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
    expect([header!.dataset.edge, footer!.dataset.edge]).toEqual(["on", "off"]);

    measure({ body, scrollTop: 0, scrollHeight: 400, clientHeight: 400 });
    expect([header!.dataset.edge, footer!.dataset.edge]).toEqual(["off", "off"]);
  });

  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("ignores a scroll inside a nested scroller", () => {
    renderDrawer({ glass: true });
    const { body, header } = parts();
    measure({ body, scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
    const nested = document.createElement("div");
    body.append(nested);
    Object.defineProperty(nested, "scrollTop", { configurable: true, value: 500 });

    fireEvent.scroll(nested);

    expect(header!.dataset.edge).toBe("off");
  });

  /** @scenario "A glass drawer's header and footer edges follow what scrolls beneath them" */
  it("releases its listener and observers when the drawer unmounts", () => {
    const { unmount } = renderDrawer({ glass: true });
    const { body } = parts();
    const removeListener = vi.spyOn(body, "removeEventListener");

    unmount();

    expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(resizeObservers.length).toBeGreaterThan(0);
    for (const observer of resizeObservers) expect(observer.observed.size).toBe(0);
    expect(resizeObservers.every((observer) => observer.disconnected > 0)).toBe(true);
  });
});
