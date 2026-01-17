/**
 * @vitest-environment jsdom
 *
 * Tests for PromptBrowserWindowContent layout mode switching
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../../prompt-playground-store/DraggableTabsBrowserStore";

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

global.localStorage = localStorageMock as Storage;

const TEST_PROJECT_ID = "test-project";

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID },
    projectId: TEST_PROJECT_ID,
  }),
}));

/**
 * Helper to create a minimal TabData object for testing
 */
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

describe("PromptBrowserWindowContent Layout Mode Detection", () => {
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

  describe("single window detection", () => {
    it("detects single window when there is only one window", () => {
      store.getState().addTab({ data: createTabData() });

      const windows = store.getState().windows;
      const isSingleWindow = windows.length === 1;

      expect(isSingleWindow).toBe(true);
    });

    it("detects multiple windows after split", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;

      // Split creates a new window
      store.getState().splitTab({ tabId: tabId! });

      const windows = store.getState().windows;
      const isSingleWindow = windows.length === 1;

      expect(isSingleWindow).toBe(false);
      expect(windows.length).toBe(2);
    });

    it("maintains multiple windows after adding tabs to each", () => {
      // Start with a tab in first window
      store.getState().addTab({ data: createTabData() });
      const firstTabId = store.getState().windows[0]?.tabs[0]?.id;

      // Split creates a new window and moves the tab there
      store.getState().splitTab({ tabId: firstTabId! });

      // Now we have 2 windows, one empty and one with our tab
      expect(store.getState().windows.length).toBe(2);

      // Add a tab to the first (now empty) window
      store.getState().addTab({ data: createTabData() });

      // Both windows now have tabs
      expect(store.getState().windows.length).toBe(2);
      expect(store.getState().windows.some((w) => w.tabs.length > 0)).toBe(
        true,
      );
    });
  });

  describe("layout mode mapping", () => {
    it("maps single window to horizontal layout", () => {
      store.getState().addTab({ data: createTabData() });

      const windows = store.getState().windows;
      const layoutMode = windows.length === 1 ? "horizontal" : "vertical";

      expect(layoutMode).toBe("horizontal");
    });

    it("maps multiple windows to vertical layout", () => {
      store.getState().addTab({ data: createTabData() });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      store.getState().splitTab({ tabId: tabId! });

      const windows = store.getState().windows;
      const layoutMode = windows.length === 1 ? "horizontal" : "vertical";

      expect(layoutMode).toBe("vertical");
    });
  });
});
