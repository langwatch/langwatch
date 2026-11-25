import path from "node:path";
import { fileURLToPath } from "node:url";

// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMPONENT_RUNTIME, islandPackages } from "../../../testing/island-packages.ts";
import { LANGWATCH_MCP_URL, PageMenu } from "../ui/page-menu.tsx";

const clipboard = vi.hoisted(() => ({ text: "", fails: false }));

vi.hoisted(() => {
  /* jsdom has no popover API; these keep its open state and fire its toggle event. */
  const toggle = (element: HTMLElement, open: boolean) => {
    if (element.hasAttribute("data-open") === open) return;
    element.toggleAttribute("data-open", open);
    const event = new Event("toggle");
    Object.assign(event, { newState: open ? "open" : "closed" });
    element.dispatchEvent(event);
  };
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      toggle(this, true);
    },
    hidePopover(this: HTMLElement) {
      toggle(this, false);
    },
  });
  /* On HTMLElement, so Element's own `matches` stays reachable underneath. */
  Object.assign(HTMLElement.prototype, {
    matches(this: HTMLElement, selector: string) {
      if (selector === ":popover-open") return this.hasAttribute("data-open");
      return Element.prototype.matches.call(this, selector);
    },
  });
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: (text: string) => {
        if (clipboard.fails) return Promise.reject(new Error("denied"));
        clipboard.text = text;
        return Promise.resolve();
      },
    },
  });
});

document.body.innerHTML = renderToStaticMarkup(
  <DesignSystemTestProvider>
    <div data-docs-menu-root="page" data-slug="guide">
      <PageMenu slug="guide" actions={["copy", "view", "mcp"]} />
    </div>
  </DesignSystemTestProvider>,
);
await import("../browser/context-menus.ts");

const trigger = () => document.querySelector<HTMLElement>("[data-docs-page-menu]");
const menu = () => document.querySelector<HTMLElement>(".docs-menu-popover");
const content = () => menu()?.querySelector<HTMLElement>('[role="menu"]') ?? null;
const item = (title: string) =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].find((row) =>
    row.textContent?.includes(title),
  );
const highlighted = () =>
  menu()?.querySelector("[data-highlighted] [data-docs-menu-title]")?.textContent ?? "";
const press = (key: string) =>
  content()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const isOpen = () => menu()?.matches(":popover-open") ?? false;

function openWithKeyboard() {
  menu()?.hidePopover();
  trigger()?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
}

beforeEach(() => {
  clipboard.text = "";
  clipboard.fails = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("# Guide\n\nThe page source.", { status: 200 })),
  );
});

describe("when a reader opens the page menu", () => {
  /** @scenario "Open the page menu on its prerendered markup" */
  it("loads no component runtime or design system code with the menu island", () => {
    const entry = path.join(
      path.dirname(path.dirname(fileURLToPath(import.meta.url))),
      "browser/context-menus.ts",
    );
    expect(islandPackages({ entry }).filter((name) => COMPONENT_RUNTIME.test(name))).toEqual([]);
  });

  /** @scenario "Open the page menu on its prerendered markup" */
  it("shows the prerendered menu as a popover and marks the trigger expanded", () => {
    expect(menu()).toBeNull();
    openWithKeyboard();
    expect(isOpen()).toBe(true);
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(content());
    expect(content()?.getAttribute("aria-label")).toBe("Page actions");
  });

  /** @scenario "Open the page menu on its prerendered markup" */
  it("moves the highlight with the arrow, Home and End keys", () => {
    openWithKeyboard();
    expect(highlighted()).toBe("Copy page");
    press("ArrowDown");
    expect(highlighted()).toBe("View as Markdown");
    press("End");
    expect(highlighted()).toBe("Copy page link");
    press("ArrowDown");
    expect(highlighted()).toBe("Copy page");
    press("Home");
    press("ArrowUp");
    expect(highlighted()).toBe("Copy page link");
    expect(content()?.getAttribute("aria-activedescendant")).toBe(
      menu()?.querySelector("[data-highlighted]")?.id,
    );
  });

  /** @scenario "Open the page menu on its prerendered markup" */
  it("returns focus to the trigger when it closes", () => {
    openWithKeyboard();
    menu()?.hidePopover();
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger());
  });
});

describe("when the reader chooses a copy action", () => {
  /** @scenario "Use clear contextual menus" */
  it("copies the page Markdown, stays open and says it copied", async () => {
    openWithKeyboard();
    press("Enter");
    await settle();
    expect(clipboard.text).toBe("# Guide\n\nThe page source.");
    expect(isOpen()).toBe(true);
    expect(item("Copied page")).toBeDefined();
    expect(menu()?.querySelector("output")?.textContent).toBe("Copied to clipboard");
  });

  /** @scenario "Offer the configured page actions" */
  it("copies the LangWatch MCP server address", async () => {
    openWithKeyboard();
    item("Copy MCP server URL")?.click();
    await settle();
    expect(clipboard.text).toBe(LANGWATCH_MCP_URL);
    expect(item("Copied MCP server URL")).toBeDefined();
    expect(item("Copy page")?.textContent).toContain("Copy page");
  });

  /** @scenario "Use clear contextual menus" */
  it("says how to carry on when the clipboard refuses", async () => {
    clipboard.fails = true;
    openWithKeyboard();
    item("Copy page link")?.click();
    await settle();
    const output = menu()?.querySelector("output");
    expect(output?.className).toBe("docs-copy-error");
    expect(output?.textContent).toMatch(/Could not copy/);
  });
});

describe("when the reader follows a link in the menu", () => {
  /** @scenario "Use clear contextual menus" */
  it("closes the menu", () => {
    openWithKeyboard();
    const link = item("View as Markdown");
    link?.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link?.click();
    expect(isOpen()).toBe(false);
  });
});
