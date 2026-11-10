// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { afterLoad } from "../after-load.ts";
import { loadSharedSheets } from "../navigation.ts";

function pendingSheet() {
  document.head.innerHTML =
    '<link data-docs-style rel="stylesheet" data-href="/assets/docs-0123456789abcdef.css">';
  return document.head.querySelector<HTMLLinkElement>("link[data-docs-style]");
}

describe("afterLoad(loadSharedSheets)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.head.innerHTML = "";
  });

  describe("when the page is still loading", () => {
    /** @scenario "Paint a page from its own styles without waiting for a stylesheet" */
    it("asks for the shared sheet only after the load event and the next painted frame", () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
      const link = pendingSheet();

      afterLoad(loadSharedSheets);
      vi.runAllTimers();
      expect(link?.getAttribute("href")).toBeNull();

      window.dispatchEvent(new Event("load"));
      expect(link?.getAttribute("href")).toBeNull();

      vi.runAllTimers();
      expect(link?.getAttribute("href")).toMatch(/\/assets\/docs-0123456789abcdef\.css$/);
      expect(link?.dataset.href).toBeUndefined();
    });
  });

  describe("when the page has already loaded", () => {
    it("asks for the shared sheet after the next painted frame", () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
      const link = pendingSheet();

      afterLoad(loadSharedSheets);
      expect(link?.getAttribute("href")).toBeNull();

      vi.runAllTimers();
      expect(link?.dataset.href).toBeUndefined();
      expect(link?.getAttribute("href")).toMatch(/\/assets\/docs-0123456789abcdef\.css$/);
    });
  });
});
