/**
 * @vitest-environment jsdom
 *
 * What the tab store keeps for a prompt's runtime variables.
 *
 * Split out of `PromptConversationSection`'s suite: these exercise the store
 * directly and render nothing, so they belong beside the store's own contract
 * rather than inside a suite about the pane that happens to read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../DraggableTabsBrowserStore";

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

const TEST_PROJECT_ID = "test-project";

const createTabData = (overrides?: Partial<TabData>): TabData => ({
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
});

describe("given a project's playground tabs", () => {
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    localStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting(TEST_PROJECT_ID);
  });

  afterEach(() => {
    clearStoreInstances();
    localStorage.clear();
  });

  describe("when variable values are set on a tab", () => {
    it("stores variable values in tab data", () => {
      store.getState().addTab({
        data: createTabData({
          variableValues: {
            name: "John",
            context: "Some context",
          },
        }),
      });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      const tabData = store.getState().getByTabId(tabId!);

      expect(tabData?.variableValues).toEqual({
        name: "John",
        context: "Some context",
      });
    });

    it("updates variable values via updateTabData", () => {
      store.getState().addTab({ data: createTabData() });

      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      expect(tabId).toBeDefined();

      store.getState().updateTabData({
        tabId: tabId!,
        updater: (data) => ({
          ...data,
          variableValues: {
            ...data.variableValues,
            name: "Updated value",
          },
        }),
      });

      const tabData = store.getState().getByTabId(tabId!);
      expect(tabData?.variableValues.name).toBe("Updated value");
    });

    it("persists variable values to localStorage", () => {
      const tabId = store.getState().addTab({
        data: createTabData({
          variableValues: { name: "Persisted" },
        }),
      });

      // Tab data (including variableValues) is persisted under its own
      // per-tab key, not the top-level window/tab-order index key.
      const tabStorageKey = `${TEST_PROJECT_ID}:tab:${tabId}`;
      const storedData = localStorage.getItem(tabStorageKey);
      expect(storedData).toBeDefined();
      expect(storedData).toContain("Persisted");
    });

    it("each tab maintains separate variable values", () => {
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab1Value" } }),
      });
      store.getState().addTab({
        data: createTabData({ variableValues: { name: "Tab2Value" } }),
      });

      const tab1Id = store.getState().windows[0]?.tabs[0]?.id;
      const tab2Id = store.getState().windows[0]?.tabs[1]?.id;

      expect(store.getState().getByTabId(tab1Id!)?.variableValues.name).toBe(
        "Tab1Value",
      );
      expect(store.getState().getByTabId(tab2Id!)?.variableValues.name).toBe(
        "Tab2Value",
      );

      store.getState().updateTabData({
        tabId: tab1Id!,
        updater: (data) => ({
          ...data,
          variableValues: { name: "Tab1Updated" },
        }),
      });

      expect(store.getState().getByTabId(tab1Id!)?.variableValues.name).toBe(
        "Tab1Updated",
      );
      expect(store.getState().getByTabId(tab2Id!)?.variableValues.name).toBe(
        "Tab2Value",
      );
    });
  });
});
