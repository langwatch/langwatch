// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTIVE_LENS_KEY = "langwatch:traces-v2:active-lens:v1";

/**
 * The viewStore computes its initial active lens at module-load time from
 * localStorage, and latches custom-lens hydration with module-level flags.
 * So each case seeds storage first, then imports a FRESH module via
 * resetModules — mirroring a real page load with that stored preference.
 */
async function freshStore() {
  vi.resetModules();
  return await import("../viewStore");
}

describe("viewStore last-used lens persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.resetModules();
  });

  describe("given no stored preference", () => {
    it("defaults to the All lens", async () => {
      const { useViewStore } = await freshStore();
      expect(useViewStore.getState().activeLensId).toBe("all-traces");
    });
  });

  describe("given a stored built-in lens id", () => {
    it("restores that lens on load (cross-project, since ids are shared)", async () => {
      localStorage.setItem(ACTIVE_LENS_KEY, "conversations");
      const { useViewStore } = await freshStore();
      expect(useViewStore.getState().activeLensId).toBe("conversations");
    });
  });

  describe("given a stored id that no longer matches any lens", () => {
    it("falls back to All", async () => {
      localStorage.setItem(ACTIVE_LENS_KEY, "custom-from-another-project");
      const { useViewStore } = await freshStore();
      expect(useViewStore.getState().activeLensId).toBe("all-traces");
    });
  });

  describe("when the user selects a lens", () => {
    it("persists the choice to localStorage", async () => {
      const { useViewStore } = await freshStore();
      useViewStore.getState().selectLens("simplified");
      expect(localStorage.getItem(ACTIVE_LENS_KEY)).toBe("simplified");
      expect(useViewStore.getState().activeLensId).toBe("simplified");
    });
  });

  describe("given a stored custom lens id", () => {
    it("restores it once the project's saved lenses hydrate", async () => {
      localStorage.setItem(ACTIVE_LENS_KEY, "custom-abc");
      const { useViewStore } = await freshStore();
      // Built-in only at init → falls back to All until hydration.
      expect(useViewStore.getState().activeLensId).toBe("all-traces");

      useViewStore.getState().setUserLenses([
        {
          id: "custom-abc",
          name: "My lens",
          filterText: "status:error",
          sort: { columnId: "time", direction: "desc" },
          grouping: "flat",
          columns: [],
          isBuiltIn: false,
        },
      ]);

      expect(useViewStore.getState().activeLensId).toBe("custom-abc");
    });

    it("does not override a lens the user picked before hydration", async () => {
      localStorage.setItem(ACTIVE_LENS_KEY, "custom-abc");
      const { useViewStore } = await freshStore();
      // User makes an explicit choice while custom lenses are still loading.
      useViewStore.getState().selectLens("conversations");

      useViewStore.getState().setUserLenses([
        {
          id: "custom-abc",
          name: "My lens",
          filterText: "status:error",
          sort: { columnId: "time", direction: "desc" },
          grouping: "flat",
          columns: [],
          isBuiltIn: false,
        },
      ]);

      expect(useViewStore.getState().activeLensId).toBe("conversations");
    });
  });
});
