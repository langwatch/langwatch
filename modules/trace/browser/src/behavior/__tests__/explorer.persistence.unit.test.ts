// @vitest-environment jsdom
/**
 * What a reader's own table preferences keep across a reload.
 * @see specs/traces-v2/trace-table.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A fresh module graph, as a page reload gives, over the same browser storage. */
async function reload() {
  vi.resetModules();
  const { BrowserUiStorage, setUiStorage, setUiStorageReader } =
    await import("@langwatch/browser-host/storage");
  setUiStorage(new BrowserUiStorage());
  setUiStorageReader("reader-a");
  const [density, explorer] = await Promise.all([
    import("../density.store.ts"),
    import("../explorer.store.ts"),
  ]);
  return { ...density, ...explorer };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("a reader's table preferences across a reload", () => {
  describe("given the reader chose compact density", () => {
    /** @scenario Density preference persists across sessions */
    it("opens on compact density after the page reloads", async () => {
      const before = await reload();
      before.useDensityStore.getState().setDensity("compact");

      const after = await reload();

      expect(after.useDensityStore.getState().density).toBe("compact");
    });
  });

  describe("given the reader hid the Tokens column", () => {
    /** @scenario Column preferences persist */
    it("still hides the Tokens column after the page reloads", async () => {
      const before = await reload();
      expect(before.useExplorerStore.getState().columnOrder).toContain("tokens");
      before.useExplorerStore.getState().toggleColumn("tokens");
      expect(before.useExplorerStore.getState().columnOrder).not.toContain("tokens");

      const after = await reload();

      expect(after.useExplorerStore.getState().columnOrder).not.toContain("tokens");
      expect(after.useExplorerStore.getState().columnOrder).toContain("duration");
    });
  });
});
