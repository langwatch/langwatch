import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface TabData {
  prompt: {
    id: string;
    handle: string | null;
    version: number;
  };
}

export interface Tab {
  id: string;
  data: TabData;
}

export interface Window {
  id: string;
  tabs: Tab[];
  activeTabId: string | null;
}

export interface DraggableTabsBrowserState {
  windows: Window[];
  activeWindowId: string | null;

  addTab: (params: { data: TabData }) => void;
  removeTab: (params: { tabId: string }) => void;
  splitTab: (params: { tabId: string }) => void;
  moveTab: (params: { tabId: string; windowId: string; index: number }) => void;
  setActiveTab: (params: { windowId: string; tabId: string }) => void;
  setActiveWindow: (params: { windowId: string }) => void;
}

export const useDraggableTabsBrowserStore = create<DraggableTabsBrowserState>()(
  immer((set) => ({
    windows: [],
    activeWindowId: null,

    setActiveWindow: ({ windowId }) => {
      set((state) => {
        state.activeWindowId = windowId;
      });
    },

    addTab: ({ data }) => {
      set((state) => {
        const tabId = `tab-${Date.now()}`;
        const newTab: Tab = { id: tabId, data };

        let activeWindow = state.windows.find(
          (w) => w.id === state.activeWindowId,
        );

        if (!activeWindow) {
          const windowId = `window-${Date.now()}`;
          activeWindow = { id: windowId, tabs: [], activeTabId: null };
          state.windows.push(activeWindow);
          state.activeWindowId = windowId;
        }

        activeWindow.tabs.push(newTab);
        activeWindow.activeTabId = tabId;
      });
    },

    removeTab: ({ tabId }) => {
      set((state) => {
        for (const window of state.windows) {
          const tabIndex = window.tabs.findIndex((tab) => tab.id === tabId);

          if (tabIndex !== -1) {
            window.tabs.splice(tabIndex, 1);

            if (window.activeTabId === tabId) {
              window.activeTabId = window.tabs[0]?.id ?? null;
            }

            if (window.tabs.length === 0) {
              const windowIndex = state.windows.findIndex(
                (w) => w.id === window.id,
              );
              state.windows.splice(windowIndex, 1);

              if (state.activeWindowId === window.id) {
                state.activeWindowId = state.windows[0]?.id ?? null;
              }
            }
            break;
          }
        }
      });
    },

    splitTab: ({ tabId }) => {
      set((state) => {
        const sourceTab = state.windows
          .flatMap((w) => w.tabs)
          .find((tab) => tab.id === tabId);

        if (!sourceTab) return;

        const newWindowId = `window-${Date.now()}`;
        const newTabId = `tab-${Date.now()}`;

        const newWindow: Window = {
          id: newWindowId,
          tabs: [{ id: newTabId, data: { ...sourceTab.data } }],
          activeTabId: newTabId,
        };

        state.windows.push(newWindow);
        state.activeWindowId = newWindowId;
      });
    },

    moveTab: ({ tabId, windowId, index }) => {
      set((state) => {
        let tabToMove: Tab | undefined;

        for (const window of state.windows) {
          const tabIndex = window.tabs.findIndex((tab) => tab.id === tabId);

          if (tabIndex !== -1) {
            [tabToMove] = window.tabs.splice(tabIndex, 1);

            if (window.activeTabId === tabId) {
              window.activeTabId = window.tabs[0]?.id ?? null;
            }
            break;
          }
        }

        if (!tabToMove) return;

        const targetWindow = state.windows.find((w) => w.id === windowId);
        if (!targetWindow) return;

        targetWindow.tabs.splice(index, 0, tabToMove);
        targetWindow.activeTabId = tabId;
        state.activeWindowId = windowId;

        state.windows = state.windows.filter(
          (window) => window.tabs.length > 0,
        );

        if (!state.windows.find((w) => w.id === state.activeWindowId)) {
          state.activeWindowId = state.windows[0]?.id ?? null;
        }
      });
    },

    setActiveTab: ({ windowId, tabId }) => {
      set((state) => {
        const window = state.windows.find((w) => w.id === windowId);
        if (window && window.tabs.some((tab) => tab.id === tabId)) {
          window.activeTabId = tabId;
          state.activeWindowId = windowId;
        }
      });
    },
  })),
);
