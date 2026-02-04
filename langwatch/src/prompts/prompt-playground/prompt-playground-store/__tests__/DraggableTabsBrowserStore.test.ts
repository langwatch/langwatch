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
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

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
