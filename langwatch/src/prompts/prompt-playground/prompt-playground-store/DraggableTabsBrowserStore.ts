"use client";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import { cloneDeep } from "lodash";
import { createLogger } from "~/utils/logger";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { z } from "zod";
import { type PromptConfigFormValues } from "~/prompts/types";
import type { DeepPartial } from "react-hook-form";
import { chatMessageSchema } from "~/server/tracer/types.generated";
import { createTabId, createWindowId } from "./utils/id-generators";

const logger = createLogger("DraggableTabsBrowserStore");

/**
 * Zod schema for the data associated with a tab in the prompt playground browser.
 * Single Responsibility: Represents the state and metadata for a prompt tab.
 */
export const TabDataSchema = z.object({
  chat: z
    .object({
      /**
       * The initial messages to display in the chat. Comes from the span data.
       */
      initialMessagesFromSpanData: z
        .array(chatMessageSchema.merge(z.object({ id: z.string() })))
        .default([]),
    })
    .default({
      initialMessagesFromSpanData: [],
    }),
  form: z.object({
    currentValues: z.custom<DeepPartial<PromptConfigFormValues>>(),
  }),
  meta: z
    .object({
      title: z.string().nullable(),
      versionNumber: z.number().optional(),
      scope: z.enum(["PROJECT", "ORGANIZATION"]).optional(),
    })
    .default({
      title: null,
      versionNumber: undefined,
      scope: undefined,
    }),
});
export type TabData = z.infer<typeof TabDataSchema>;

/**
 * Zod schema for a single tab in the browser interface.
 * Single Responsibility: Container for tab identity and associated data.
 */
export const TabSchema = z.object({
  id: z.string(),
  data: TabDataSchema,
});
export type Tab = z.infer<typeof TabSchema>;

/**
 * Zod schema for a tabbedWindow containing multiple tabs.
 * Single Responsibility: Container for managing a collection of tabs and their active state.
 */
export const WindowSchema = z.object({
  id: z.string(),
  tabs: z.array(TabSchema),
  activeTabId: z.string(),
});
export type Window = z.infer<typeof WindowSchema>;

/**
 * State interface for the draggable tabs browser store.
 * Single Responsibility: Defines the complete state and actions for managing a multi-tabbedWindow, multi-tab browser interface.
 */
export interface DraggableTabsBrowserState {
  /** Array of all windows in the browser */
  windows: Window[];
  /** ID of the currently active tabbedWindow, null if no windows */
  activeWindowId: string | null;

  /** Add a new tab to the active tabbedWindow (or create a new tabbedWindow if none exists) */
  addTab: (params: { data: TabData }) => void;
  /** Remove a tab by its ID, cleaning up empty windows */
  removeTab: (params: { tabId: string }) => void;
  /** Split a tab into a new tabbedWindow */
  splitTab: (params: { tabId: string }) => void;
  /** Move a tab to a different tabbedWindow at a specific index */
  moveTab: (params: { tabId: string; windowId: string; index: number }) => void;
  /** Set the active tab for a specific tabbedWindow */
  setActiveTab: (params: { windowId: string; tabId: string }) => void;
  /** Set the active tabbedWindow */
  setActiveWindow: (params: { windowId: string }) => void;
  /** Update tab data using an updater function for flexible partial updates */
  updateTabData: (params: {
    tabId: string;
    updater: (data: TabData) => TabData;
  }) => void;
  /** Get data by tabId */
  getByTabId: (tabId: string) => TabData | undefined;
  /** Is the tab id active? Checks across all windows and tavs */
  isTabIdActive: (tabId: string) => boolean;

  /** Reset store to initial state and clear localStorage */
  reset: () => void;
}

const initialState = {
  windows: [],
  activeWindowId: null,
};

// Store instances cache to maintain singleton per project
const storeInstances = new Map<
  string,
  ReturnType<typeof createDraggableTabsBrowserStore>
>();

/**
 * Get store instance for testing purposes.
 * Single Responsibility: Provides access to store instances for unit tests.
 */
export function getStoreForTesting(projectId: string) {
  if (!storeInstances.has(projectId)) {
    storeInstances.set(projectId, createDraggableTabsBrowserStore(projectId));
  }
  return storeInstances.get(projectId)!;
}

/**
 * Clear all store instances (for testing).
 * Single Responsibility: Resets the singleton cache between tests.
 */
export function clearStoreInstances() {
  storeInstances.clear();
}

/**
 * Schema for the persisted state (data only, no methods)
 */
const PersistedStateSchema = z.object({
  windows: z.array(WindowSchema),
  activeWindowId: z.string().nullable(),
});

function createDraggableTabsBrowserStore(projectId: string) {
  const storageKey = `${projectId}:draggable-tabs-browser-store`;

  return create<DraggableTabsBrowserState>()(
    persist(
      immer((set, get) => ({
        ...initialState,

        /**
         * Set the active tabbedWindow by ID.
         * Single Responsibility: Updates the active tabbedWindow state.
         */
        setActiveWindow: ({ windowId }) => {
          set((state) => {
            const windowExists = state.windows.some((w) => w.id === windowId);
            if (!windowExists) {
              logger.warn({ windowId }, "Window not found, cannot set active");
              return;
            }
            state.activeWindowId = windowId;
          });
        },

        /**
         * Add a new tab to the active tabbedWindow, or create a new tabbedWindow if none exists.
         * Single Responsibility: Creates and adds a new tab with the provided data.
         */
        addTab: ({ data }) => {
          set((state) => {
            const tabId = createTabId();
            const newTab: Tab = { id: tabId, data };

            let activeWindow = state.windows.find(
              (w) => w.id === state.activeWindowId,
            );

            if (!activeWindow) {
              const windowId = createWindowId();
              activeWindow = { id: windowId, tabs: [], activeTabId: tabId };
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
            // Find the window containing the tab
            const windowIndex = state.windows.findIndex((w) =>
              w.tabs.some((t) => t.id === tabId),
            );

            if (windowIndex === -1) {
              logger.warn({ tabId }, "Tab not found, cannot remove");
              return;
            }

            const tabbedWindow = state.windows[windowIndex];
            if (!tabbedWindow) {
              logger.warn({ tabId }, "Tab not found, cannot remove");
              return;
            }
            const tabIndex = tabbedWindow.tabs.findIndex(
              (tab) => tab.id === tabId,
            );

            // Remove the tab from the window
            tabbedWindow.tabs.splice(tabIndex, 1);

            // If window is now empty, remove it entirely
            if (tabbedWindow.tabs.length === 0) {
              state.windows.splice(windowIndex, 1);

              // If we removed the active window, activate the window at same index (next window shifts into position) or previous window if it was last
              if (state.activeWindowId === tabbedWindow.id) {
                const nextWindow =
                  state.windows[windowIndex] ?? state.windows[windowIndex - 1];
                state.activeWindowId = nextWindow?.id ?? null;
              }
            } else if (tabbedWindow.activeTabId === tabId) {
              // If the removed tab was the active tab, activate tab at same index (next tab shifts into position) or previous tab if it was last
              const targetTab =
                tabbedWindow.tabs[tabIndex] ?? tabbedWindow.tabs[tabIndex - 1];

              if (!targetTab) {
                logger.warn(
                  { tabId },
                  "No target tab found after removal. This should never happen.",
                );
                return;
              }

              tabbedWindow.activeTabId = targetTab.id;
            }
          });
        },

        /**
         * Split a tab into a new tabbedWindow by duplicating it.
         * Single Responsibility: Creates a new tabbedWindow with a copy of the specified tab.
         */
        splitTab: ({ tabId }) => {
          set((state) => {
            // Find the tabbedWindow that contains the source tab
            const tabWindowIndex = state.windows.findIndex((w) =>
              w.tabs.some((t) => t.id === tabId),
            );
            const tabWindow = state.windows[tabWindowIndex];

            if (!tabWindow) {
              logger.warn(
                { tabId },
                "Tab not found in any window, cannot split",
              );
              return;
            }

            // Find the source tab in the tabbedWindow
            const sourceTab = tabWindow.tabs.find((t) => t.id === tabId);
            if (!sourceTab) {
              logger.warn(
                { tabId, windowId: tabWindow.id },
                "Source tab not found in window, cannot split",
              );
              return;
            }

            // Create a new tabbedWindow with a copy of the source tab
            const newWindowId = createWindowId();
            const newTabId = createTabId();
            const newWindow: Window = {
              id: newWindowId,
              tabs: [
                {
                  id: newTabId,
                  data: cloneDeep(sourceTab.data),
                },
              ],
              activeTabId: newTabId,
            };

            // Insert new tabbedWindow directly after the source tabbedWindow
            state.windows.splice(tabWindowIndex + 1, 0, newWindow);
            state.activeWindowId = newWindowId;
          });
        },

        /**
         * Move a tab from one tabbedWindow to another at a specific index.
         * Single Responsibility: Handles tab drag-and-drop between windows with cleanup.
         */
        moveTab: ({ tabId, windowId, index }) => {
          set((state) => {
            // Find the source window containing the tab
            const sourceWindowIndex = state.windows.findIndex((w) =>
              w.tabs.some((t) => t.id === tabId),
            );

            if (sourceWindowIndex === -1) {
              logger.warn({ tabId }, "Tab not found, cannot move");
              return;
            }

            const sourceWindow = state.windows[sourceWindowIndex];
            if (!sourceWindow) {
              logger.warn({ tabId }, "Source window not found, cannot move");
              return;
            }
            const tabIndex = sourceWindow.tabs.findIndex((t) => t.id === tabId);
            const [tabToMove] = sourceWindow.tabs.splice(tabIndex, 1);
            if (!tabToMove) {
              logger.warn({ tabId }, "Tab not found, cannot move");
              return;
            }

            // Update source window's active tab if needed
            if (
              sourceWindow.activeTabId === tabId &&
              sourceWindow.tabs.length > 0
            ) {
              const targetTab =
                sourceWindow.tabs[tabIndex] ?? sourceWindow.tabs[tabIndex - 1];
              if (targetTab) {
                sourceWindow.activeTabId = targetTab.id;
              }
            }

            // Add tab to target tabbedWindow
            const targetWindow = state.windows.find((w) => w.id === windowId);
            if (!targetWindow) {
              logger.warn(
                { windowId },
                "Target window not found, cannot move tab",
              );
              // Restore tab to source window
              sourceWindow.tabs.push(tabToMove);
              return;
            }

            // Clamp index to valid range
            const clampedIndex = Math.max(
              0,
              Math.min(index, targetWindow.tabs.length),
            );
            if (clampedIndex !== index) {
              logger.warn(
                { tabId, windowId, requestedIndex: index, clampedIndex },
                "Index out of bounds, clamping to valid range",
              );
            }

            targetWindow.tabs.splice(clampedIndex, 0, tabToMove);
            targetWindow.activeTabId = tabId;
            state.activeWindowId = windowId;

            // Clean up empty windows
            state.windows = state.windows.filter(
              (tabbedWindow) => tabbedWindow.tabs.length > 0,
            );

            // Ensure we have a valid active tabbedWindow
            if (!state.windows.find((w) => w.id === state.activeWindowId)) {
              state.activeWindowId = state.windows[0]?.id ?? null;
            }
          });
        },

        /**
         * Set the active tab for a specific tabbedWindow.
         * Single Responsibility: Updates active tab and tabbedWindow state.
         */
        setActiveTab: ({ windowId, tabId }) => {
          set((state) => {
            const tabbedWindow = state.windows.find((w) => w.id === windowId);

            if (!tabbedWindow) {
              logger.warn(
                { windowId, tabId },
                "Window not found, cannot set active tab",
              );
              return;
            }

            if (!tabbedWindow.tabs.some((tab) => tab.id === tabId)) {
              logger.warn(
                { windowId, tabId },
                "Tab not found in window, cannot set active",
              );
              return;
            }

            tabbedWindow.activeTabId = tabId;
            state.activeWindowId = windowId;
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

            if (!tab) {
              logger.warn({ tabId }, "Tab not found, cannot update data");
              return;
            }

            tab.data = updater(tab.data);
          });
        },

        /**
         * Check if a tab ID is currently active.
         * Single Responsibility: Determines if the given tab is the active tab in the active tabbedWindow.
         */
        isTabIdActive: (tabId) => {
          const state = get();
          return state.windows.some((w) => w.activeTabId === tabId);
        },

        /**
         * Reset the store to initial state and clear localStorage.
         * Single Responsibility: Clears all tabs and windows.
         */
        reset: () => {
          set(initialState);
          try {
            localStorage.removeItem(storageKey);
          } catch (error) {
            logger.error({ error }, "Failed to clear localStorage");
          }
        },

        /**
         * Get data by tabId
         */
        getByTabId: (tabId) => {
          const state = get();
          return state.windows
            .flatMap((w) => w.tabs)
            .find((t) => t.id === tabId)?.data;
        },
      })),
      {
        name: storageKey,
        storage: createJSONStorage(() => localStorage),

        // Validate and handle corrupted data during rehydration
        onRehydrateStorage: () => (state, error) => {
          if (error) {
            logger.error(
              { error },
              "Failed to rehydrate store, clearing corrupted data",
            );
            try {
              localStorage.removeItem(storageKey);
            } catch (e) {
              logger.error({ error: e }, "Failed to clear corrupted storage");
            }
            return;
          }

          // Validate the rehydrated state shape
          if (state) {
            const validation = PersistedStateSchema.safeParse({
              windows: state.windows,
              activeWindowId: state.activeWindowId,
            });

            if (!validation.success) {
              logger.error(
                { error: validation.error },
                "Invalid store data shape, resetting to initial state",
              );
              try {
                localStorage.removeItem(storageKey);
              } catch (e) {
                logger.error({ error: e }, "Failed to clear invalid storage");
              }
              // Reset to initial state
              Object.assign(state, initialState);
              return;
            }

            // Validate logical consistency
            let hasInconsistency = false;

            // Remove windows with no tabs
            state.windows = state.windows.filter((w) => {
              if (w.tabs.length === 0) {
                logger.warn(
                  { windowId: w.id },
                  "Removing empty window during rehydration",
                );
                hasInconsistency = true;
                return false;
              }
              return true;
            });

            // Validate each window's activeTabId exists in its tabs
            state.windows.forEach((window) => {
              const hasActiveTab = window.tabs.some(
                (t) => t.id === window.activeTabId,
              );
              if (!hasActiveTab) {
                logger.warn(
                  { windowId: window.id, activeTabId: window.activeTabId },
                  "Active tab not found in window, resetting to first tab",
                );
                window.activeTabId = window.tabs[0]?.id ?? "";
                hasInconsistency = true;
              }
            });

            // Validate activeWindowId exists in windows
            if (state.activeWindowId) {
              const hasActiveWindow = state.windows.some(
                (w) => w.id === state.activeWindowId,
              );
              if (!hasActiveWindow) {
                logger.warn(
                  { activeWindowId: state.activeWindowId },
                  "Active window not found, resetting to first window",
                );
                state.activeWindowId = state.windows[0]?.id ?? null;
                hasInconsistency = true;
              }
            }

            // If state is now empty after cleanup, reset completely
            if (state.windows.length === 0) {
              logger.warn(
                "No valid windows after rehydration, resetting to initial state",
              );
              Object.assign(state, initialState);
              try {
                localStorage.removeItem(storageKey);
              } catch (e) {
                logger.error({ error: e }, "Failed to clear invalid storage");
              }
            } else if (hasInconsistency) {
              // Log that we fixed inconsistencies
              logger.info("Fixed state inconsistencies during rehydration");
            }
          }
        },
      },
    ),
  );
}

/**
 * Hook to access the project-scoped draggable tabs browser store.
 * Single Responsibility: Provides access to the appropriate store instance for the current project.
 */
export function useDraggableTabsBrowserStore(): DraggableTabsBrowserState;
export function useDraggableTabsBrowserStore<T>(
  selector: (state: DraggableTabsBrowserState) => T,
): T;
export function useDraggableTabsBrowserStore<T>(
  selector?: (state: DraggableTabsBrowserState) => T,
): T | DraggableTabsBrowserState {
  const { projectId } = useOrganizationTeamProject();
  const key = projectId ?? "__default__";

  if (!projectId && process.env.NODE_ENV === "development") {
    console.warn(
      `useDraggableTabsBrowserStore called without projectId.
        This should not happen if used within DashboardLayout, guarantees projectId is available.`,
    );
  }

  if (!storeInstances.has(key)) {
    storeInstances.set(key, createDraggableTabsBrowserStore(key));
  }

  const useStore = storeInstances.get(key)!;

  // Call the store hook with or without selector
  // @ts-expect-error - Zustand types are complex, but this works at runtime
  return useStore(selector);
}

/**
 * Utility to manually clear a corrupted store from localStorage.
 * Single Responsibility: Provides emergency recovery mechanism for corrupted store data.
 */
export function clearDraggableTabsBrowserStore(projectId: string) {
  const storageKey = `${projectId}:draggable-tabs-browser-store`;
  try {
    localStorage.removeItem(storageKey);
    storeInstances.delete(projectId);
    logger.info({ projectId }, "Cleared draggable tabs browser store");
  } catch (error) {
    logger.error({ error, projectId }, "Failed to clear store");
  }
}
