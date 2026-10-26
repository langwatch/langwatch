// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchTemplates } from "../ui/search-template.tsx";

/* The real store fetches, decodes and memoises the index; only the network is a stand-in. */
const indexLoads = vi.hoisted(() => ({ count: 0, fails: true }));

vi.hoisted(() => {
  /* jsdom has the dialog element but not its modal methods. */
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  Element.prototype.scrollIntoView = () => {};
});

vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    indexLoads.count += 1;
    if (indexLoads.fails) return new Response("", { status: 503 });
    return Response.json([{ slug: "intro", title: "Intro", description: "" }]);
  }),
);

document.body.innerHTML = renderToStaticMarkup(
  <DesignSystemTestProvider>
    <button type="button" data-docs-search="">
      Search
    </button>
    <SearchTemplates />
  </DesignSystemTestProvider>,
);
await import("../browser/search.ts");

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.docs-search-dialog");
const input = () => dialog()?.querySelector("input") ?? null;
const part = (name: string) => dialog()?.querySelector<HTMLElement>(`[data-search-part="${name}"]`);
const selectedLabel = () =>
  dialog()?.querySelector('[data-selected] [data-part="label"]')?.textContent ?? "";
const press = (key: string, init: KeyboardEventInit = {}) =>
  (document.activeElement ?? document).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openSearch() {
  dialog()?.close();
  document.querySelector<HTMLElement>("[data-docs-search]")?.focus();
  press("k", { ctrlKey: true });
  await settle();
}

beforeEach(() => {
  indexLoads.fails = false;
});

/* First, while the island has no index yet: once one loads, reopening reuses it. */
describe("when the search index fails to load", () => {
  /** @scenario "Reuse the parsed search index and retry a failed load" */
  it("offers Retry, which loads the index again", async () => {
    indexLoads.fails = true;
    await openSearch();
    expect(part("failed")?.hidden).toBe(false);
    const before = indexLoads.count;
    indexLoads.fails = false;
    part("retry")?.click();
    await settle();
    expect(indexLoads.count).toBe(before + 1);
    expect(part("failed")?.hidden).toBe(true);
  });
});

describe("when a reader opens search", () => {
  /** @scenario "Open search only on explicit activation" */
  it("opens the prerendered command bar as a modal dialog with the field focused", async () => {
    await openSearch();
    expect(dialog()?.open).toBe(true);
    expect(document.activeElement).toBe(input());
    expect(input()?.getAttribute("aria-controls")).toBe("docs-search-results");
  });

  /** @scenario "Open search only on explicit activation" */
  it("returns focus to the search button when it closes", async () => {
    await openSearch();
    dialog()?.close();
    expect(document.activeElement).toBe(document.querySelector("[data-docs-search]"));
  });

  /** @scenario "Open search only on explicit activation" */
  it("closes on Escape even with a query in the field", async () => {
    await openSearch();
    const field = input();
    if (field) field.value = "traces";
    press("Escape");
    expect(dialog()?.open).toBe(false);
  });

  /** @scenario "Use the shared command surface" */
  it("moves the selection with the arrow keys and names it for assistive technology", async () => {
    await openSearch();
    expect(selectedLabel()).toBe("Open app");
    press("ArrowDown");
    expect(selectedLabel()).toBe("GitHub");
    expect(input()?.getAttribute("aria-activedescendant")).toBe("docs-command-1");
    press("ArrowUp");
    press("ArrowUp");
    expect(selectedLabel()).toBe("Copy page");
  });

  /** @scenario "Use the shared command surface" */
  it("filters the rows as the reader types", async () => {
    await openSearch();
    const field = input();
    if (!field) throw new Error("no search field");
    field.value = "theme";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      [...(dialog()?.querySelectorAll('[data-part="label"]') ?? [])].map((row) => row.textContent),
    ).toEqual(["Toggle theme"]);
    expect(part("status")?.textContent).toBe("1 results");
  });
});

describe("when rendering the search results throws", () => {
  /** @scenario "Explain a search that fails to render" */
  it("says search stopped working in place of the results", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    /* Without the action row's template, the real `fromTemplate` throws mid-render. */
    const template = document.getElementById("docs-search-action");
    template?.remove();
    try {
      await openSearch();
      expect(part("broken")?.hidden).toBe(false);
      expect(part("broken")?.textContent).toMatch(/Search stopped working/);
      expect(dialog()?.querySelectorAll("[data-index]")).toHaveLength(0);
    } finally {
      if (template) document.body.append(template);
      quiet.mockRestore();
    }
  });
});
