import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../DraggableTabsBrowserStore";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

/** Builds a large-ish string so per-tab payload size differences are obvious. */
function buildLargeContent(label: string): string {
  return `${label}-`.repeat(5000); // ~30-40KB per tab
}

/**
 * Helper to create a minimal TabData object for testing
 */
function createTabData(overrides?: Partial<TabData>): TabData {
  return {
    chat: {
      initialMessagesFromSpanData: [],
    },
    form: {
      currentValues: {},
    },
    meta: {
      title: null,
      versionNumber: undefined,
      scope: undefined,
    },
    variableValues: {},
    ...overrides,
  };
}

describe("DraggableTabsBrowserStore", () => {
  const TEST_PROJECT_ID = "test-project";
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    // Clear localStorage to prevent state bleeding between tests
    localStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting(TEST_PROJECT_ID);
  });

  afterEach(() => {
    clearStoreInstances();
    localStorage.clear();
  });

  describe("initial state", () => {
    it("has empty windows array", () => {
      expect(store.getState().windows).toEqual([]);
    });

    it("has null activeWindowId", () => {
      expect(store.getState().activeWindowId).toBeNull();
    });
  });

  describe("addTab", () => {
    it("creates first tabbedWindow when none exist", () => {
      store.getState().addTab({ data: createTabData() });

      const state = store.getState();
      expect(state.windows).toHaveLength(1);
      expect(state.activeWindowId).toBe(state.windows[0]?.id);
    });

    it("adds tab to active tabbedWindow", () => {
      store.getState().addTab({ data: createTabData() });
      store.getState().addTab({ data: createTabData() });

      const state = store.getState();
      expect(state.windows).toHaveLength(1);
      expect(state.windows[0]?.tabs).toHaveLength(2);
    });

    it("sets new tab as active", () => {
      store.getState().addTab({ data: createTabData() });
      store.getState().addTab({ data: createTabData() });

      const state = store.getState();
      const secondTabId = state.windows[0]?.tabs[1]?.id;
      expect(state.windows[0]?.activeTabId).toBe(secondTabId);
    });
  });

  describe("removeTab", () => {
    describe("when tab is not active", () => {
      it("removes tab without changing activeTabId", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const state = store.getState();
        const activeTabId = state.windows[0]?.activeTabId;
        const firstTabId = state.windows[0]?.tabs[0]?.id;
        expect(firstTabId).toBeDefined();

        store.getState().removeTab({ tabId: firstTabId! });

        expect(store.getState().windows[0]?.activeTabId).toBe(activeTabId);
      });
    });

    describe("when removing active tab that is not last", () => {
      it("activates tab at same index (next tab shifts into position)", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const state = store.getState();
        const tabbedWindow = state.windows[0];
        const firstTabId = tabbedWindow?.tabs[0]?.id;
        const secondTabId = tabbedWindow?.tabs[1]?.id;

        store
          .getState()
          .setActiveTab({ windowId: tabbedWindow!.id, tabId: firstTabId! });
        store.getState().removeTab({ tabId: firstTabId! });

        expect(store.getState().windows[0]?.activeTabId).toBe(secondTabId);
      });
    });

    describe("when removing last active tab", () => {
      it("activates previous tab", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const state = store.getState();
        const firstTabId = state.windows[0]?.tabs[0]?.id;
        const lastTabId = state.windows[0]?.tabs[1]?.id;
        expect(lastTabId).toBeDefined();

        // Last tab is already active
        store.getState().removeTab({ tabId: lastTabId! });

        expect(store.getState().windows[0]?.activeTabId).toBe(firstTabId);
      });
    });

    describe("when removing last tab in tabbedWindow", () => {
      it("removes empty tabbedWindow", () => {
        store.getState().addTab({ data: createTabData() });
        const tabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(tabId).toBeDefined();

        store.getState().removeTab({ tabId: tabId! });

        expect(store.getState().windows).toHaveLength(0);
        expect(store.getState().activeWindowId).toBeNull();
      });
    });

    describe("when removing last tab in active tabbedWindow that is not last", () => {
      it("activates tabbedWindow at same index (next tabbedWindow shifts into position)", () => {
        store.getState().addTab({ data: createTabData() });
        const firstTabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(firstTabId).toBeDefined();

        // Create 3 windows
        store.getState().splitTab({ tabId: firstTabId! });
        const secondTabId = store.getState().windows[1]?.tabs[0]?.id;
        expect(secondTabId).toBeDefined();
        store.getState().splitTab({ tabId: secondTabId! });

        // Activate middle tabbedWindow
        const middleWindowId = store.getState().windows[1]?.id;
        expect(middleWindowId).toBeDefined();
        store.getState().setActiveWindow({ windowId: middleWindowId! });
        const middleTabId = store.getState().windows[1]?.tabs[0]?.id;
        expect(middleTabId).toBeDefined();
        const thirdWindowId = store.getState().windows[2]?.id;

        // Remove middle tabbedWindow's tab
        store.getState().removeTab({ tabId: middleTabId! });

        expect(store.getState().activeWindowId).toBe(thirdWindowId);
      });
    });
  });

  describe("moveTab", () => {
    describe("when moving tab between windows", () => {
      it("removes from source and adds to target", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const firstTabId = store.getState().windows[0]?.tabs[0]?.id;
        const secondTabId = store.getState().windows[0]?.tabs[1]?.id;
        expect(secondTabId).toBeDefined();

        // Split second tab to create new tabbedWindow
        store.getState().splitTab({ tabId: secondTabId! });
        const targetWindowId = store.getState().windows[1]?.id;
        expect(targetWindowId).toBeDefined();
        expect(firstTabId).toBeDefined();

        // Move first tab to the new tabbedWindow
        store.getState().moveTab({
          tabId: firstTabId!,
          windowId: targetWindowId!,
          index: 0,
        });

        expect(
          store.getState().windows[0]?.tabs.some((t) => t.id === firstTabId),
        ).toBe(false);
        expect(store.getState().windows[1]?.tabs[0]?.id).toBe(firstTabId);
      });
    });

    describe("when index is out of bounds", () => {
      it("clamps to valid range", () => {
        store.getState().addTab({ data: createTabData() });
        const firstTabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(firstTabId).toBeDefined();

        store.getState().splitTab({ tabId: firstTabId! });
        const targetWindowId = store.getState().windows[1]?.id;
        expect(targetWindowId).toBeDefined();

        store.getState().moveTab({
          tabId: firstTabId!,
          windowId: targetWindowId!,
          index: 999,
        });

        const targetWindow = store
          .getState()
          .windows.find((w) => w.id === targetWindowId);
        expect(targetWindow?.tabs[targetWindow.tabs.length - 1]?.id).toBe(
          firstTabId,
        );
      });
    });

    describe("when moving active tab with remaining tabs in source", () => {
      it("activates tab at same index in source (next tab shifts into position)", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const sourceWindow = store.getState().windows[0];
        expect(sourceWindow).toBeDefined();
        const firstTabId = sourceWindow?.tabs[0]?.id;
        const secondTabId = sourceWindow?.tabs[1]?.id;
        expect(firstTabId).toBeDefined();

        store.getState().setActiveTab({
          windowId: sourceWindow!.id,
          tabId: firstTabId!,
        });

        store.getState().splitTab({ tabId: firstTabId! });
        const targetWindowId = store.getState().windows[1]?.id;
        expect(targetWindowId).toBeDefined();

        store.getState().moveTab({
          tabId: firstTabId!,
          windowId: targetWindowId!,
          index: 0,
        });

        expect(store.getState().windows[0]?.activeTabId).toBe(secondTabId);
      });
    });

    describe("when moving within same tabbedWindow", () => {
      it("reorders tabs to new position", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const tabbedWindow = store.getState().windows[0];
        expect(tabbedWindow).toBeDefined();
        const firstTabId = tabbedWindow?.tabs[0]?.id;
        const secondTabId = tabbedWindow?.tabs[1]?.id;
        const thirdTabId = tabbedWindow?.tabs[2]?.id;
        expect(firstTabId).toBeDefined();

        store.getState().moveTab({
          tabId: firstTabId!,
          windowId: tabbedWindow!.id,
          index: 2,
        });

        const updatedWindow = store.getState().windows[0];
        expect(updatedWindow?.tabs[0]?.id).toBe(secondTabId);
        expect(updatedWindow?.tabs[1]?.id).toBe(thirdTabId);
        expect(updatedWindow?.tabs[2]?.id).toBe(firstTabId);
      });
    });
  });

  describe("splitTab", () => {
    describe("when splitting a tab", () => {
      it("creates new tabbedWindow after source tabbedWindow", () => {
        store.getState().addTab({ data: createTabData() });
        const tabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(tabId).toBeDefined();

        store.getState().splitTab({ tabId: tabId! });

        expect(store.getState().windows).toHaveLength(2);
      });

      it("deep clones tab data", () => {
        const originalData = createTabData({ meta: { title: "Original" } });
        store.getState().addTab({ data: originalData });

        const tabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(tabId).toBeDefined();
        store.getState().splitTab({ tabId: tabId! });

        // Modify original
        store.getState().updateTabData({
          tabId: tabId!,
          updater: (data) => ({
            ...data,
            meta: { ...data.meta, title: "Modified" },
          }),
        });

        const originalTab = store.getState().windows[0]?.tabs[0];
        const clonedTab = store.getState().windows[1]?.tabs[0];

        expect(originalTab?.data.meta.title).toBe("Modified");
        expect(clonedTab?.data.meta.title).toBe("Original");
      });

      it("sets new tabbedWindow and tab as active", () => {
        store.getState().addTab({ data: createTabData() });
        const tabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(tabId).toBeDefined();

        store.getState().splitTab({ tabId: tabId! });

        const newWindowId = store.getState().windows[1]?.id;
        const newTabId = store.getState().windows[1]?.tabs[0]?.id;

        expect(store.getState().activeWindowId).toBe(newWindowId);
        expect(store.getState().windows[1]?.activeTabId).toBe(newTabId);
      });
    });
  });

  describe("setActiveTab", () => {
    it("sets tab and tabbedWindow as active", () => {
      store.getState().addTab({ data: createTabData() });
      store.getState().addTab({ data: createTabData() });

      const tabbedWindow = store.getState().windows[0];
      expect(tabbedWindow).toBeDefined();
      const firstTabId = tabbedWindow?.tabs[0]?.id;
      expect(firstTabId).toBeDefined();

      store
        .getState()
        .setActiveTab({ windowId: tabbedWindow!.id, tabId: firstTabId! });

      expect(store.getState().windows[0]?.activeTabId).toBe(firstTabId);
      expect(store.getState().activeWindowId).toBe(tabbedWindow!.id);
    });
  });

  describe("setActiveWindow", () => {
    it("updates activeWindowId", () => {
      store.getState().addTab({ data: createTabData() });
      const firstTabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(firstTabId).toBeDefined();

      store.getState().splitTab({ tabId: firstTabId! });
      const firstWindowId = store.getState().windows[0]?.id;
      expect(firstWindowId).toBeDefined();

      store.getState().setActiveWindow({ windowId: firstWindowId! });

      expect(store.getState().activeWindowId).toBe(firstWindowId);
    });
  });

  describe("updateTabData", () => {
    it("applies updater function to tab data", () => {
      store
        .getState()
        .addTab({ data: createTabData({ meta: { title: "Original" } }) });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          meta: { ...data.meta, title: "Updated" },
        }),
      });

      expect(store.getState().windows[0]?.tabs[0]?.data.meta.title).toBe(
        "Updated",
      );
    });
  });

  describe("persistence", () => {
    describe("when updating one tab's data with other large tabs open", () => {
      it("does not rewrite the untouched tab's full content", () => {
        store.getState().addTab({
          data: createTabData({
            form: { currentValues: { handle: buildLargeContent("tab-1") } },
          }),
        });
        store.getState().addTab({
          data: createTabData({
            form: { currentValues: { handle: buildLargeContent("tab-2") } },
          }),
        });

        const tab1Id = store.getState().windows[0]?.tabs[0]?.id;
        const tab2Id = store.getState().windows[0]?.tabs[1]?.id;
        expect(tab1Id).toBeDefined();
        expect(tab2Id).toBeDefined();

        const originalSetItem = localStorageMock.setItem.bind(localStorageMock);
        const setItemSpy = vi.fn(originalSetItem);
        localStorageMock.setItem = setItemSpy;

        try {
          store.getState().updateTabData({
            tabId: tab2Id!,
            updater: (data) => ({
              ...data,
              meta: { ...data.meta, title: "Updated" },
            }),
          });

          // Every write that happened while editing tab2 must not embed
          // tab1's untouched large content anywhere in its payload.
          const tab1Content = buildLargeContent("tab-1");
          for (const call of setItemSpy.mock.calls) {
            const [, value] = call;
            expect(value.includes(tab1Content)).toBe(false);
          }

          // Sanity check: tab1's content is still recoverable after tab2 was
          // edited, proving we didn't just fail to persist it at all.
          const persistedTab1 = localStorageMock.getItem(
            `${TEST_PROJECT_ID}:tab:${tab1Id!}`,
          );
          expect(persistedTab1).toContain(tab1Content);
        } finally {
          localStorageMock.setItem = originalSetItem;
        }
      });
    });
  });

  describe("rehydration recovery", () => {
    describe("when reading the legacy single-key persisted format", () => {
      it("adopts the embedded tab data and migrates it to per-tab keys", async () => {
        const lightKey = `${TEST_PROJECT_ID}:draggable-tabs-browser-store`;

        // Legacy format: full tab data embedded in the index, NO per-tab keys.
        // This is what an existing user's localStorage looks like on upgrade.
        localStorage.setItem(
          lightKey,
          JSON.stringify({
            state: {
              windows: [
                {
                  id: "window-1",
                  activeTabId: "tab-1",
                  tabs: [
                    { id: "tab-1", data: createTabData({ meta: { title: "Legacy A" } }) },
                    { id: "tab-2", data: createTabData({ meta: { title: "Legacy B" } }) },
                  ],
                },
              ],
              activeWindowId: "window-1",
            },
            version: 0,
          }),
        );

        await store.persist.rehydrate();

        // Both tabs survive the upgrade with their data intact.
        const state = store.getState();
        expect(state.windows[0]?.tabs.map((t) => t.id)).toEqual([
          "tab-1",
          "tab-2",
        ]);
        expect(state.getByTabId("tab-1")?.meta.title).toBe("Legacy A");
        expect(state.getByTabId("tab-2")?.meta.title).toBe("Legacy B");

        // A subsequent write migrates each tab into its own per-tab key.
        store.getState().updateTabData({
          tabId: "tab-1",
          updater: (data) => ({ ...data, meta: { ...data.meta, title: "A2" } }),
        });
        expect(localStorage.getItem(`${TEST_PROJECT_ID}:tab:tab-1`)).toContain(
          "A2",
        );
        expect(
          localStorage.getItem(`${TEST_PROJECT_ID}:tab:tab-2`),
        ).not.toBeNull();
      });
    });

    describe("when one tab's per-tab data key is missing", () => {
      it("drops only that tab and keeps the rest instead of wiping the store", async () => {
        const lightKey = `${TEST_PROJECT_ID}:draggable-tabs-browser-store`;
        const tab1Key = `${TEST_PROJECT_ID}:tab:tab-1`;

        // Index references two tabs, but only tab-1's data key exists — tab-2's
        // per-tab key is absent (e.g. evicted, or a partial write). tab-1 must
        // survive; fabricating tab-2 would fail whole-state validation and lose
        // tab-1 too.
        localStorage.setItem(
          lightKey,
          JSON.stringify({
            state: {
              windows: [
                {
                  id: "window-1",
                  tabs: [{ id: "tab-1" }, { id: "tab-2" }],
                  activeTabId: "tab-1",
                },
              ],
              activeWindowId: "window-1",
            },
            version: 0,
          }),
        );
        localStorage.setItem(
          tab1Key,
          JSON.stringify(createTabData({ meta: { title: "Survivor" } })),
        );

        await store.persist.rehydrate();

        const state = store.getState();
        expect(state.windows).toHaveLength(1);
        expect(state.windows[0]?.tabs.map((t) => t.id)).toEqual(["tab-1"]);
        expect(state.getByTabId("tab-1")?.meta.title).toBe("Survivor");
      });
    });

    describe("when a persisted tab fails schema validation", () => {
      it("removes all per-tab keys along with the light index key", async () => {
        const lightKey = `${TEST_PROJECT_ID}:draggable-tabs-browser-store`;
        const tab1Key = `${TEST_PROJECT_ID}:tab:tab-1`;
        const tab2Key = `${TEST_PROJECT_ID}:tab:tab-2`;

        // Light index key parses fine and references both tabs...
        localStorage.setItem(
          lightKey,
          JSON.stringify({
            state: {
              windows: [
                {
                  id: "window-1",
                  tabs: [{ id: "tab-1" }, { id: "tab-2" }],
                  activeTabId: "tab-1",
                },
              ],
              activeWindowId: "window-1",
            },
            version: 0,
          }),
        );
        localStorage.setItem(tab1Key, JSON.stringify(createTabData()));
        // ...but tab-2's own data is corrupted (missing required `form`
        // field), which fails PersistedStateSchema validation and should
        // trigger the "invalid shape" recovery path.
        localStorage.setItem(tab2Key, JSON.stringify({}));

        await store.persist.rehydrate();

        expect(localStorage.getItem(tab1Key)).toBeNull();
        expect(localStorage.getItem(tab2Key)).toBeNull();
        expect(localStorage.getItem(lightKey)).toBeNull();
      });
    });

    describe("when the light index key itself is unparseable", () => {
      it("falls back to removing the light key without throwing", async () => {
        const lightKey = `${TEST_PROJECT_ID}:draggable-tabs-browser-store`;
        const tab1Key = `${TEST_PROJECT_ID}:tab:tab-1`;

        localStorage.setItem(tab1Key, JSON.stringify(createTabData()));
        localStorage.setItem(lightKey, "{not valid json");

        await store.persist.rehydrate();

        expect(localStorage.getItem(lightKey)).toBeNull();
        expect(localStorage.getItem(tab1Key)).toBeNull();
      });
    });
  });

  describe("getByTabId", () => {
    it("returns tab data when tab exists", () => {
      const tabData = createTabData({ meta: { title: "Test" } });
      store.getState().addTab({ data: tabData });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      const result = store.getState().getByTabId(tabId!);

      expect(result?.meta.title).toBe("Test");
    });

    it("returns undefined when tab does not exist", () => {
      const result = store.getState().getByTabId("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("isTabIdActive", () => {
    describe("when tab is active in any tabbedWindow", () => {
      it("returns true", () => {
        store.getState().addTab({ data: createTabData() });
        const tabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(tabId).toBeDefined();

        expect(store.getState().isTabIdActive(tabId!)).toBe(true);
      });
    });

    describe("when tab exists but is not active", () => {
      it("returns false", () => {
        store.getState().addTab({ data: createTabData() });
        store.getState().addTab({ data: createTabData() });

        const firstTabId = store.getState().windows[0]?.tabs[0]?.id;
        expect(firstTabId).toBeDefined();

        expect(store.getState().isTabIdActive(firstTabId!)).toBe(false);
      });
    });

    describe("when tab does not exist", () => {
      it("returns false", () => {
        expect(store.getState().isTabIdActive("non-existent")).toBe(false);
      });
    });
  });

  describe("reset", () => {
    it("clears all windows and sets activeWindowId to null", () => {
      store.getState().addTab({ data: createTabData() });
      store.getState().reset();

      expect(store.getState().windows).toEqual([]);
      expect(store.getState().activeWindowId).toBeNull();
    });

    it("removes the per-tab localStorage keys of its own tabs", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(localStorage.getItem(`${TEST_PROJECT_ID}:tab:${tabId}`)).not.toBeNull();

      store.getState().reset();

      expect(localStorage.getItem(`${TEST_PROJECT_ID}:tab:${tabId}`)).toBeNull();
      expect(
        localStorage.getItem(`${TEST_PROJECT_ID}:draggable-tabs-browser-store`),
      ).toBeNull();
    });

    it("removes orphaned per-tab keys this instance never tracked", () => {
      // Simulates the same project open in a second browser tab: another
      // store instance wrote a per-tab key that this instance's in-memory
      // ref map never saw. reset() must still clear it via the prefix scan.
      const orphanKey = `${TEST_PROJECT_ID}:tab:orphan-from-other-instance`;
      localStorage.setItem(orphanKey, JSON.stringify(createTabData()));

      store.getState().addTab({ data: createTabData() });
      store.getState().reset();

      expect(localStorage.getItem(orphanKey)).toBeNull();
    });
  });

  describe("variableValues", () => {
    it("initializes with empty variableValues", () => {
      store.getState().addTab({ data: createTabData() });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      const tabData = store.getState().getByTabId(tabId!);

      expect(tabData?.variableValues).toEqual({});
    });

    it("stores variable values via updateTabData", () => {
      store.getState().addTab({ data: createTabData() });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          variableValues: {
            ...data.variableValues,
            name: "John",
            context: "Some context",
          },
        }),
      });

      const tabData = store.getState().getByTabId(tabId!);
      expect(tabData?.variableValues).toEqual({
        name: "John",
        context: "Some context",
      });
    });

    it("preserves variableValues when updating other fields", () => {
      store.getState().addTab({
        data: createTabData({
          variableValues: { name: "John" },
        }),
      });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      // Update meta, variableValues should remain
      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          meta: { ...data.meta, title: "New Title" },
        }),
      });

      const tabData = store.getState().getByTabId(tabId!);
      expect(tabData?.variableValues).toEqual({ name: "John" });
      expect(tabData?.meta.title).toBe("New Title");
    });

    it("keeps separate variableValues per tab", () => {
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab1" } }),
      });
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab2" } }),
      });

      const tab1Id = store.getState().windows[0]?.tabs[0]?.id;
      const tab2Id = store.getState().windows[0]?.tabs[1]?.id;

      expect(store.getState().getByTabId(tab1Id!)?.variableValues).toEqual({
        name: "Tab1",
      });
      expect(store.getState().getByTabId(tab2Id!)?.variableValues).toEqual({
        name: "Tab2",
      });
    });

    it("deep clones variableValues when splitting tab", () => {
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Original" } }),
      });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      store.getState().splitTab({ tabId: tabId! });

      // Modify original
      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          variableValues: { name: "Modified" },
        }),
      });

      const originalTab = store.getState().windows[0]?.tabs[0];
      const clonedTab = store.getState().windows[1]?.tabs[0];

      expect(originalTab?.data.variableValues).toEqual({ name: "Modified" });
      expect(clonedTab?.data.variableValues).toEqual({ name: "Original" });
    });
  });
});
