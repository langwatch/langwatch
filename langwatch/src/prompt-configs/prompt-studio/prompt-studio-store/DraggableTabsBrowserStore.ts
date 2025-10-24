import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { DeepPartial } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Data associated with a tab in the prompt studio browser.
 * Single Responsibility: Represents the state and metadata for a prompt tab.
 */
export interface TabData {
  /** Partial form state for this tab */
  form: {
    /** Default values to initialize the form */
    defaultValues: DeepPartial<PromptConfigFormValues>;
    /** Current form dirty state */
    isDirty: boolean;
  };
  /** Derived, live-updating metadata for tab */
  meta: {
    /** Title shown on tab (from form handle) */
    title: string | null;
    /** Version number for display, if available */
    versionNumber?: number;
    /** Scope of the tab */
    scope?: "PROJECT" | "ORGANIZATION";
  };
}

/**
 * Represents a single tab in the browser interface.
 * Single Responsibility: Container for tab identity and associated data.
 */
export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** The data associated with this tab */
  data: TabData;
}

/**
 * Represents a window containing multiple tabs.
 * Single Responsibility: Container for managing a collection of tabs and their active state.
 */
export interface Window {
  /** Unique identifier for the window */
  id: string;
  /** Array of tabs in this window */
  tabs: Tab[];
  /** ID of the currently active tab, null if no tabs */
  activeTabId: string | null;
}

/**
 * State interface for the draggable tabs browser store.
 * Single Responsibility: Defines the complete state and actions for managing a multi-window, multi-tab browser interface.
 */
export interface DraggableTabsBrowserState {
  /** Array of all windows in the browser */
  windows: Window[];
  /** ID of the currently active window, null if no windows */
  activeWindowId: string | null;

  /** Add a new tab to the active window (or create a new window if none exists) */
  addTab: (params: { data: TabData }) => void;
  /** Remove a tab by its ID, cleaning up empty windows */
  removeTab: (params: { tabId: string }) => void;
  /** Split a tab into a new window */
  splitTab: (params: { tabId: string }) => void;
  /** Move a tab to a different window at a specific index */
  moveTab: (params: { tabId: string; windowId: string; index: number }) => void;
  /** Set the active tab for a specific window */
  setActiveTab: (params: { windowId: string; tabId: string }) => void;
  /** Set the active window */
  setActiveWindow: (params: { windowId: string }) => void;
  /** Update tab data using an updater function for flexible partial updates */
  updateTabData: (params: {
    tabId: string;
    updater: (data: TabData) => TabData;
  }) => void;
}

/**
 * Zustand store for managing draggable tabs browser state.
 * Single Responsibility: Provides centralized state management for a multi-window, multi-tab browser interface with drag-and-drop capabilities.
 *
 * Features:
 * - Multi-window support with independent tab collections
 * - Tab drag-and-drop between windows
 * - Automatic cleanup of empty windows
 * - Active state tracking for windows and tabs
 * - Immutable updates using Immer middleware
 */
export const useDraggableTabsBrowserStore = create<DraggableTabsBrowserState>()(
  persist(
    // TODO: because of immer, we are doing a lot of deep clones. Probably shouldn't.
    immer(
      (set: (updater: (state: DraggableTabsBrowserState) => void) => void) => ({
        windows: [],
        activeWindowId: null,

        /**
         * Set the active window by ID.
         * Single Responsibility: Updates the active window state.
         */
        setActiveWindow: ({ windowId }) => {
          set((state) => {
            state.activeWindowId = windowId;
          });
        },

        /**
         * Add a new tab to the active window, or create a new window if none exists.
         * Single Responsibility: Creates and adds a new tab with the provided data.
         */
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

        /**
         * Remove a tab by its ID and clean up empty windows.
         * Single Responsibility: Removes a tab and handles cleanup of empty windows and active state.
         */
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

        /**
         * Split a tab into a new window by duplicating it.
         * Single Responsibility: Creates a new window with a copy of the specified tab.
         */
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

        /**
         * Move a tab from one window to another at a specific index.
         * Single Responsibility: Handles tab drag-and-drop between windows with cleanup.
         */
        moveTab: ({ tabId, windowId, index }) => {
          set((state) => {
            let tabToMove: Tab | undefined;

            // Remove tab from source window
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

            // Add tab to target window
            const targetWindow = state.windows.find((w) => w.id === windowId);
            if (!targetWindow) return;

            targetWindow.tabs.splice(index, 0, tabToMove);
            targetWindow.activeTabId = tabId;
            state.activeWindowId = windowId;

            // Clean up empty windows
            state.windows = state.windows.filter(
              (window) => window.tabs.length > 0,
            );

            // Ensure we have a valid active window
            if (!state.windows.find((w) => w.id === state.activeWindowId)) {
              state.activeWindowId = state.windows[0]?.id ?? null;
            }
          });
        },

        /**
         * Set the active tab for a specific window.
         * Single Responsibility: Updates active tab and window state.
         */
        setActiveTab: ({ windowId, tabId }) => {
          set((state) => {
            const window = state.windows.find((w) => w.id === windowId);
            if (window?.tabs.some((tab) => tab.id === tabId)) {
              window.activeTabId = tabId;
              state.activeWindowId = windowId;
            }
          });
        },

        /**
         * Update tab data using an updater function for flexible partial updates.
         * Single Responsibility: Applies data transformations to a specific tab.
         *
         * @example
         * // Mark tab as having unsaved changes
         * updateTabData({
         *   tabId: 'tab-123',
         *   updater: (data) => ({ ...data, hasUnsavedChanges: true })
         * });
         *
         * @example
         * // Update prompt version
         * updateTabData({
         *   tabId: 'tab-123',
         *   updater: (data) => ({
         *     ...data,
         *     prompt: { ...data.prompt, version: data.prompt.version + 1 }
         *   })
         * });
         */
        updateTabData: ({ tabId, updater }) => {
          set((state) => {
            const tab = state.windows
              .flatMap((w) => w.tabs)
              .find((t) => t.id === tabId);

            if (tab) {
              tab.data = updater(tab.data);
            }
          });
        },
      }),
    ),
    {
      name: "draggable-tabs-browser-store",
      storage: createJSONStorage(() => localStorage), // localStorage key
    },
  ),
);
