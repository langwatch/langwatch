// @vitest-environment jsdom
/**
 * A search belongs to the project and the person it was typed for.
 * @see specs/traces-v2/search-scope.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EVAL_SEARCH = 'eval:"is the answer polite?"';

/** A fresh module graph, as a page load gives, over the same browser storage. */
async function load() {
  vi.resetModules();
  const storage = await import("@langwatch/browser-host/storage");
  storage.setUiStorage(new storage.BrowserUiStorage());
  storage.setUiStorageReader("reader-a");
  const { useExplorerStore } = await import("../explorer.store.ts");
  return { storage, useExplorerStore };
}

/** What the search bar and the lens dirty sync do when the user submits a search. */
function search(store: Awaited<ReturnType<typeof load>>["useExplorerStore"], text: string) {
  store.getState().applyQueryText(text);
  store.getState().setFilterDraft(store.getState().queryText);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("a search typed on the All lens", () => {
  describe("given a search on project A", () => {
    let useExplorerStore: Awaited<ReturnType<typeof load>>["useExplorerStore"];

    beforeEach(async () => {
      ({ useExplorerStore } = await load());
      useExplorerStore.getState().setProject("project-a");
      search(useExplorerStore, EVAL_SEARCH);
      useExplorerStore.getState().registerEvalRun({ key: "run-key", runId: "run-1" });
    });

    describe("when the user opens the Observe page in a different project", () => {
      /** @scenario "A search does not follow the user into another project" */
      it("leaves the bar on the lens's own filter with no run held", () => {
        useExplorerStore.getState().setProject("project-b");
        useExplorerStore.getState().selectLens("all-traces", { persist: false });

        const state = useExplorerStore.getState();
        expect(state.queryText).toBe("");
        expect(state.evalRuns).toEqual({});
        expect(state.draftState.get("all-traces")?.filter).toBeUndefined();
      });
    });

    describe("when the same project is named again", () => {
      it("keeps the search", () => {
        useExplorerStore.getState().setProject("project-a");

        expect(useExplorerStore.getState().queryText).toBe(EVAL_SEARCH);
      });
    });
  });

  describe("when the session changes to another person", () => {
    /** @scenario "A search does not carry into another person's session" */
    it("leaves the bar on the lens's own filter", async () => {
      const { storage, useExplorerStore } = await load();
      useExplorerStore.getState().setProject("project-a");
      search(useExplorerStore, EVAL_SEARCH);

      storage.setUiStorageReader("reader-b");
      useExplorerStore.getState().selectLens("all-traces", { persist: false });

      expect(useExplorerStore.getState().queryText).toBe("");
    });
  });

  describe("when the page reloads at an address that names no search", () => {
    /** @scenario "A search is not remembered on the device" */
    it("starts on the lens's own filter but keeps the hidden column", async () => {
      const before = await load();
      search(before.useExplorerStore, EVAL_SEARCH);
      before.useExplorerStore.getState().toggleColumn("tokens");

      const after = await load();
      after.useExplorerStore.getState().selectLens("all-traces", { persist: false });

      const state = after.useExplorerStore.getState();
      expect(state.queryText).toBe("");
      expect(state.columnOrder).not.toContain("tokens");
    });
  });
});
