import { describe, expect, it } from "vitest";
import { mergeUiPageLoaders } from "../src/behavior/ui-feature-loaders";
import { resolveUiPageLoader, type UiPageLoader } from "../src/behavior/ui-page-loaders";

function aLoader(): UiPageLoader {
  return async () => ({ default: () => null });
}

describe("given the pages apps/ui serves itself and the pages the host still serves", () => {
  describe("when both registries name the same page key", () => {
    it("serves the page apps/ui owns, so a completed move needs no edit on the host", () => {
      const own = aLoader();
      const host = aLoader();

      const merged = mergeUiPageLoaders({
        own: { "pages/index": own },
        host: { "pages/index": host },
      });

      expect(resolveUiPageLoader({ registry: merged, key: "pages/index" })).toBe(own);
    });
  });

  describe("when only the host names a page key", () => {
    it("falls back to the host, so an unmoved page keeps routing", () => {
      const host = aLoader();

      const merged = mergeUiPageLoaders({ own: {}, host: { "pages/index": host } });

      expect(resolveUiPageLoader({ registry: merged, key: "pages/index" })).toBe(host);
    });
  });

  describe("when neither registry names a page key", () => {
    it("refuses at composition time and names the missing key", () => {
      const merged = mergeUiPageLoaders({ own: {}, host: {} });

      expect(() => resolveUiPageLoader({ registry: merged, key: "pages/index" })).toThrow(
        'No page loader is registered for route page "pages/index".',
      );
    });
  });

  describe("when the merge runs", () => {
    it("leaves both registries it was handed untouched", () => {
      const own = { "pages/index": aLoader() };
      const host = { "pages/index": aLoader(), "pages/authorize": aLoader() };

      mergeUiPageLoaders({ own, host });

      expect(Object.keys(own)).toEqual(["pages/index"]);
      expect(Object.keys(host)).toEqual(["pages/index", "pages/authorize"]);
    });
  });
});
