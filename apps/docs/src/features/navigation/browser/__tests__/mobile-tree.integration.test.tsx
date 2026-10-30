// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { fillMobileNav } from "../mobile-tree.ts";

const RAIL = `
  <div class="docs-left-rail">
    <div class="docs-agent-launcher"><select><option>Claude Code</option></select></div>
    <nav aria-label="Documentation sections"><ul><li><a href="/introduction" aria-current="true">Platform</a></li></ul></nav>
    <div>
      <nav class="docs-nav-tree" id="page-tree" tabindex="-1" aria-label="Page navigation" data-indicator-ready="">
        <ul><li><a href="/introduction" aria-current="page">Introduction</a></li></ul>
        <span class="docs-nav-indicator" aria-hidden="true"></span>
      </nav>
    </div>
  </div>
  <dialog id="docs-mobile-nav"><div data-docs-mobile-body=""></div></dialog>`;

describe("when a reader opens the mobile navigation", () => {
  beforeEach(() => {
    document.body.innerHTML = RAIL;
  });

  const open = () => {
    const dialog = document.getElementById("docs-mobile-nav") as HTMLElement;
    fillMobileNav({ dialog });
    return dialog;
  };

  /** @scenario "Open the mobile navigation from the page's one navigation tree" */
  it("shows the rail's sections and page tree with the current page marked", () => {
    const dialog = open();
    expect(dialog.querySelector('nav[aria-label="Documentation sections"]')).not.toBeNull();
    const tree = dialog.querySelector('nav[aria-label="Page navigation"]');
    expect(tree?.querySelector('[aria-current="page"]')?.textContent).toBe("Introduction");
    expect(dialog.querySelector(".docs-agent-launcher")).not.toBeNull();
  });

  /** @scenario "Open the mobile navigation from the page's one navigation tree" */
  it("repeats no identifier and drops the rail's selection marker", () => {
    const dialog = open();
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tree = dialog.querySelector<HTMLElement>('nav[aria-label="Page navigation"]');
    expect(tree?.hasAttribute("tabindex")).toBe(false);
    expect(tree?.hasAttribute("data-indicator-ready")).toBe(false);
    expect(dialog.querySelector(".docs-nav-indicator")).toBeNull();
  });

  /** @scenario "Open the mobile navigation from the page's one navigation tree" */
  it("replaces its contents on every opening instead of stacking copies", () => {
    open();
    const dialog = open();
    expect(dialog.querySelectorAll('nav[aria-label="Page navigation"]')).toHaveLength(1);
  });
});
