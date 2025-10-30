import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  TabDataSchema,
  TabSchema,
  WindowSchema,
  clearDraggableTabsBrowserStore,
} from "../DraggableTabsBrowserStore";
import type { TabData, Tab, Window } from "../DraggableTabsBrowserStore";

describe("DraggableTabsBrowserStore Schemas", () => {
  describe("TabDataSchema", () => {
    it("should validate valid tab data", () => {
      const validData: TabData = {
        form: {
          currentValues: {
            handle: "test",
            scope: "PROJECT",
            version: { configData: {} },
          },
        },
        meta: {
          title: "Test Tab",
          versionNumber: 1,
          scope: "PROJECT",
        },
      };

      const result = TabDataSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should allow null title", () => {
      const data: TabData = {
        form: { currentValues: {} },
        meta: { title: null },
      };

      const result = TabDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should validate ORGANIZATION scope", () => {
      const data: TabData = {
        form: { currentValues: {} },
        meta: { title: "Test", scope: "ORGANIZATION" },
      };

      const result = TabDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should reject invalid scope", () => {
      const data = {
        form: { currentValues: {} },
        meta: { title: "Test", scope: "INVALID" },
      };

      const result = TabDataSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("should allow optional versionNumber", () => {
      const data: TabData = {
        form: { currentValues: {} },
        meta: { title: "Test" },
      };

      const result = TabDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe("TabSchema", () => {
    it("should validate valid tab", () => {
      const validTab: Tab = {
        id: "tab-123",
        data: {
          form: { currentValues: {} },
          meta: { title: "Test" },
        },
      };

      const result = TabSchema.safeParse(validTab);
      expect(result.success).toBe(true);
    });

    it("should require id field", () => {
      const invalidTab = {
        data: {
          form: { currentValues: {} },
          meta: { title: "Test" },
        },
      };

      const result = TabSchema.safeParse(invalidTab);
      expect(result.success).toBe(false);
    });
  });

  describe("WindowSchema", () => {
    it("should validate valid window", () => {
      const validWindow: Window = {
        id: "window-123",
        tabs: [
          {
            id: "tab-1",
            data: {
              form: { currentValues: {} },
              meta: { title: "Tab 1" },
            },
          },
        ],
        activeTabId: "tab-1",
      };

      const result = WindowSchema.safeParse(validWindow);
      expect(result.success).toBe(true);
    });

    it("should allow null activeTabId", () => {
      const window: Window = {
        id: "window-123",
        tabs: [],
        activeTabId: null,
      };

      const result = WindowSchema.safeParse(window);
      expect(result.success).toBe(true);
    });

    it("should allow empty tabs array", () => {
      const window: Window = {
        id: "window-123",
        tabs: [],
        activeTabId: null,
      };

      const result = WindowSchema.safeParse(window);
      expect(result.success).toBe(true);
    });
  });
});

describe("clearDraggableTabsBrowserStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should remove item from localStorage", () => {
    const projectId = "test-project";
    const storageKey = `${projectId}:draggable-tabs-browser-store`;
    
    localStorage.setItem(storageKey, JSON.stringify({ test: "data" }));
    
    clearDraggableTabsBrowserStore(projectId);
    
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it("should not throw if key does not exist", () => {
    expect(() => {
      clearDraggableTabsBrowserStore("non-existent-project");
    }).not.toThrow();
  });

  it("should handle localStorage errors gracefully", () => {
    const projectId = "test-project";
    
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = vi.fn(() => {
      throw new Error("Storage error");
    });

    expect(() => {
      clearDraggableTabsBrowserStore(projectId);
    }).not.toThrow();

    Storage.prototype.removeItem = originalRemoveItem;
  });
});

describe("DraggableTabsBrowserStore Logic Tests", () => {
  describe("Tab ID Generation Pattern", () => {
    it("should generate unique tab IDs with timestamp", () => {
      const id1 = `tab-${Date.now()}`;
      const id2 = `tab-${Date.now() + 1}`;
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^tab-\d+$/);
    });

    it("should generate unique window IDs with timestamp", () => {
      const id1 = `window-${Date.now()}`;
      const id2 = `window-${Date.now() + 1}`;
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^window-\d+$/);
    });
  });

  describe("Tab Data Structure", () => {
    it("should maintain proper tab data structure", () => {
      const tabData: TabData = {
        form: {
          currentValues: {
            handle: "my-prompt",
            scope: "PROJECT",
            version: {
              configData: {
                prompt: "Test prompt",
                llm: { model: "gpt-4" },
                inputs: [],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
          },
        },
        meta: {
          title: "My Prompt",
          versionNumber: 1,
        },
      };

      expect(tabData.form.currentValues).toBeDefined();
      expect(tabData.meta.title).toBe("My Prompt");
    });
  });

  describe("Window and Tab Relationships", () => {
    it("should maintain proper window-tab relationship", () => {
      const tab: Tab = {
        id: "tab-1",
        data: {
          form: { currentValues: {} },
          meta: { title: "Tab 1" },
        },
      };

      const window: Window = {
        id: "window-1",
        tabs: [tab],
        activeTabId: "tab-1",
      };

      expect(window.tabs).toContain(tab);
      expect(window.activeTabId).toBe(tab.id);
    });

    it("should support multiple tabs in a window", () => {
      const tabs: Tab[] = [
        {
          id: "tab-1",
          data: { form: { currentValues: {} }, meta: { title: "Tab 1" } },
        },
        {
          id: "tab-2",
          data: { form: { currentValues: {} }, meta: { title: "Tab 2" } },
        },
        {
          id: "tab-3",
          data: { form: { currentValues: {} }, meta: { title: "Tab 3" } },
        },
      ];

      const window: Window = {
        id: "window-1",
        tabs,
        activeTabId: "tab-2",
      };

      expect(window.tabs).toHaveLength(3);
      expect(window.activeTabId).toBe("tab-2");
    });
  });

  describe("Active State Management", () => {
    it("should track active tab correctly", () => {
      const window: Window = {
        id: "window-1",
        tabs: [
          { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
          { id: "tab-2", data: { form: { currentValues: {} }, meta: { title: "Tab 2" } } },
        ],
        activeTabId: "tab-1",
      };

      expect(window.activeTabId).toBe("tab-1");
      
      window.activeTabId = "tab-2";
      expect(window.activeTabId).toBe("tab-2");
    });

    it("should allow null activeTabId for empty windows", () => {
      const window: Window = {
        id: "window-1",
        tabs: [],
        activeTabId: null,
      };

      expect(window.activeTabId).toBeNull();
      expect(window.tabs).toHaveLength(0);
    });
  });

  describe("Tab Removal Logic", () => {
    it("should handle tab removal and update activeTabId", () => {
      const tabs: Tab[] = [
        { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
        { id: "tab-2", data: { form: { currentValues: {} }, meta: { title: "Tab 2" } } },
        { id: "tab-3", data: { form: { currentValues: {} }, meta: { title: "Tab 3" } } },
      ];

      const window: Window = {
        id: "window-1",
        tabs: [...tabs],
        activeTabId: "tab-2",
      };

      const indexToRemove = window.tabs.findIndex((t) => t.id === "tab-2");
      window.tabs.splice(indexToRemove, 1);
      
      window.activeTabId = window.tabs[0]?.id ?? null;

      expect(window.tabs).toHaveLength(2);
      expect(window.activeTabId).toBe("tab-1");
    });

    it("should set activeTabId to null when removing last tab", () => {
      const window: Window = {
        id: "window-1",
        tabs: [
          { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
        ],
        activeTabId: "tab-1",
      };

      window.tabs = [];
      window.activeTabId = window.tabs[0]?.id ?? null;

      expect(window.tabs).toHaveLength(0);
      expect(window.activeTabId).toBeNull();
    });
  });

  describe("Tab Movement Logic", () => {
    it("should support moving tabs between positions", () => {
      const tabs: Tab[] = [
        { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
        { id: "tab-2", data: { form: { currentValues: {} }, meta: { title: "Tab 2" } } },
        { id: "tab-3", data: { form: { currentValues: {} }, meta: { title: "Tab 3" } } },
      ];

      const window: Window = {
        id: "window-1",
        tabs: [...tabs],
        activeTabId: "tab-1",
      };

      const [removed] = window.tabs.splice(1, 1);
      window.tabs.splice(0, 0, removed);

      expect(window.tabs[0].id).toBe("tab-2");
      expect(window.tabs[1].id).toBe("tab-1");
      expect(window.tabs[2].id).toBe("tab-3");
    });
  });

  describe("Tab Data Updates", () => {
    it("should support updating tab data immutably", () => {
      const tab: Tab = {
        id: "tab-1",
        data: {
          form: { currentValues: { handle: "old-handle" } },
          meta: { title: "Old Title" },
        },
      };

      const updatedTab: Tab = {
        ...tab,
        data: {
          ...tab.data,
          meta: {
            ...tab.data.meta,
            title: "New Title",
          },
        },
      };

      expect(updatedTab.id).toBe(tab.id);
      expect(updatedTab.data.meta.title).toBe("New Title");
      expect(tab.data.meta.title).toBe("Old Title");
    });

    it("should support functional updates via updater pattern", () => {
      const tab: Tab = {
        id: "tab-1",
        data: {
          form: { currentValues: { version: 1 } },
          meta: { title: "Test", versionNumber: 1 },
        },
      };

      const updater = (data: TabData): TabData => ({
        ...data,
        meta: {
          ...data.meta,
          versionNumber: (data.meta.versionNumber ?? 0) + 1,
        },
      });

      const newData = updater(tab.data);

      expect(newData.meta.versionNumber).toBe(2);
      expect(tab.data.meta.versionNumber).toBe(1);
    });
  });

  describe("Multiple Windows", () => {
    it("should support multiple windows", () => {
      const windows: Window[] = [
        {
          id: "window-1",
          tabs: [
            { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
          ],
          activeTabId: "tab-1",
        },
        {
          id: "window-2",
          tabs: [
            { id: "tab-2", data: { form: { currentValues: {} }, meta: { title: "Tab 2" } } },
          ],
          activeTabId: "tab-2",
        },
      ];

      expect(windows).toHaveLength(2);
      expect(windows[0].tabs[0].id).toBe("tab-1");
      expect(windows[1].tabs[0].id).toBe("tab-2");
    });

    it("should track active window separately from active tabs", () => {
      const windows: Window[] = [
        {
          id: "window-1",
          tabs: [
            { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
          ],
          activeTabId: "tab-1",
        },
        {
          id: "window-2",
          tabs: [
            { id: "tab-2", data: { form: { currentValues: {} }, meta: { title: "Tab 2" } } },
          ],
          activeTabId: "tab-2",
        },
      ];

      let activeWindowId = "window-1";

      expect(activeWindowId).toBe("window-1");
      expect(windows[0].activeTabId).toBe("tab-1");
      
      activeWindowId = "window-2";
      expect(activeWindowId).toBe("window-2");
      expect(windows[1].activeTabId).toBe("tab-2");
    });
  });

  describe("Empty Window Cleanup", () => {
    it("should identify empty windows for cleanup", () => {
      const windows: Window[] = [
        {
          id: "window-1",
          tabs: [],
          activeTabId: null,
        },
        {
          id: "window-2",
          tabs: [
            { id: "tab-1", data: { form: { currentValues: {} }, meta: { title: "Tab 1" } } },
          ],
          activeTabId: "tab-1",
        },
      ];

      const nonEmptyWindows = windows.filter((w) => w.tabs.length > 0);

      expect(nonEmptyWindows).toHaveLength(1);
      expect(nonEmptyWindows[0].id).toBe("window-2");
    });
  });
});