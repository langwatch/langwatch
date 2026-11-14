// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { followSystemTheme } from "../../../lib/theme.ts";
import { ThemeMenu } from "../ui/theme-menu.tsx";

const system = vi.hoisted(() => ({
  dark: false,
  listeners: [] as ((event: { matches: boolean }) => void)[],
}));

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
    matches(this: HTMLElement, selector: string) {
      if (selector === ":popover-open") return this.hasAttribute("data-open");
      return Element.prototype.matches.call(this, selector);
    },
  });
  /* The operating system's colour scheme, switchable from the test. */
  Object.assign(window, {
    matchMedia: (query: string) => ({
      matches: query.includes("dark") ? system.dark : false,
      addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) =>
        system.listeners.push(listener),
    }),
  });
});

document.body.innerHTML = renderToStaticMarkup(
  <DesignSystemTestProvider>
    <ThemeMenu />
  </DesignSystemTestProvider>,
);
await import("../browser/context-menus.ts");
followSystemTheme();

const trigger = () => document.querySelector<HTMLElement>("[data-docs-theme-menu]");
const menu = () => document.querySelector<HTMLElement>(".docs-menu-popover");
const choice = (value: string) =>
  menu()?.querySelector<HTMLElement>(`[data-docs-theme-choice="${value}"]`) ?? null;
const checked = () =>
  [...(menu()?.querySelectorAll<HTMLElement>('[aria-checked="true"]') ?? [])].map(
    (item) => item.dataset.docsThemeChoice,
  );
const isDark = () => document.documentElement.classList.contains("dark");

function openMenu() {
  menu()?.hidePopover();
  trigger()?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
}

beforeEach(() => {
  localStorage.clear();
  system.dark = false;
  document.documentElement.className = "light";
});

describe("the theme menu", () => {
  describe("when a reader opens it", () => {
    /** @scenario "Choose the light, dark or system theme" */
    it("offers System, Light and Dark and ticks the stored choice", () => {
      localStorage.setItem("theme", "dark");
      openMenu();
      expect(menu()?.matches(":popover-open")).toBe(true);
      expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
      expect(
        [...(menu()?.querySelectorAll<HTMLElement>("[data-docs-theme-choice]") ?? [])].map(
          (item) => item.textContent,
        ),
      ).toEqual(["System", "Light", "Dark"]);
      expect(checked()).toEqual(["dark"]);
    });

    /** @scenario "Choose the light, dark or system theme" */
    it("ticks System when nothing is stored", () => {
      openMenu();
      expect(checked()).toEqual(["system"]);
    });
  });

  describe("when the reader chooses Dark", () => {
    /** @scenario "Choose the light, dark or system theme" */
    it("paints the page dark, remembers the choice and closes the menu", () => {
      openMenu();
      choice("dark")?.click();
      expect(isDark()).toBe(true);
      expect(localStorage.getItem("theme")).toBe("dark");
      expect(menu()?.matches(":popover-open")).toBe(false);
    });

    /** @scenario "Choose the light, dark or system theme" */
    it("opens again on the very next click", () => {
      openMenu();
      choice("dark")?.click();
      trigger()?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      expect(menu()?.matches(":popover-open")).toBe(true);
    });
  });

  describe("when the reader chooses System", () => {
    /** @scenario "Choose the light, dark or system theme" */
    it("follows the operating system, now and when it switches", () => {
      system.dark = true;
      openMenu();
      choice("system")?.click();
      expect(isDark()).toBe(true);
      expect(localStorage.getItem("theme")).toBe("system");
      system.listeners.forEach((listener) => listener({ matches: false }));
      expect(isDark()).toBe(false);
    });

    /** @scenario "Choose the light, dark or system theme" */
    it("leaves a page on a fixed theme alone when the operating system switches", () => {
      openMenu();
      choice("light")?.click();
      system.listeners.forEach((listener) => listener({ matches: true }));
      expect(isDark()).toBe(false);
    });
  });
});
