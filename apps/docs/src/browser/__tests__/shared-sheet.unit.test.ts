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
    document.body.innerHTML = "";
  });

  describe("when the page is still loading", () => {
    /** @scenario "Paint a page from its own styles without waiting for a stylesheet" */
    it("asks for the shared sheet only after the load event and the next painted frame", async () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
      const link = pendingSheet();

      afterLoad(loadSharedSheets);
      await vi.runAllTimersAsync();
      expect(link?.getAttribute("href")).toBeNull();

      window.dispatchEvent(new Event("load"));
      expect(link?.getAttribute("href")).toBeNull();

      await vi.runAllTimersAsync();
      expect(link?.getAttribute("href")).toMatch(/\/assets\/docs-0123456789abcdef\.css$/);
      expect(link?.dataset.href).toBeUndefined();
    });
  });

  describe("when the page has already loaded", () => {
    it("asks for the shared sheet after the next painted frame", async () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
      const link = pendingSheet();

      afterLoad(loadSharedSheets);
      expect(link?.getAttribute("href")).toBeNull();

      await vi.runAllTimersAsync();
      expect(link?.dataset.href).toBeUndefined();
      expect(link?.getAttribute("href")).toMatch(/\/assets\/docs-0123456789abcdef\.css$/);
    });
  });

  describe("when the first screen shows a poster", () => {
    afterEach(() => {
      Reflect.deleteProperty(HTMLImageElement.prototype, "decode");
    });

    /** @scenario "Paint a page from its own styles without waiting for a stylesheet" */
    it("asks for the shared sheet only once that poster is decoded", async () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
      const link = pendingSheet();
      document.body.innerHTML = '<video poster="/media/clip-poster.webp"></video>';
      let decoded = () => {};
      const decode = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            decoded = resolve;
          }),
      );
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        value: decode,
        configurable: true,
      });

      afterLoad(loadSharedSheets);
      await vi.runAllTimersAsync();
      expect(decode).toHaveBeenCalledOnce();
      expect(link?.getAttribute("href")).toBeNull();

      decoded();
      await vi.runAllTimersAsync();
      expect(link?.getAttribute("href")).toMatch(/\/assets\/docs-0123456789abcdef\.css$/);
    });
  });
});
