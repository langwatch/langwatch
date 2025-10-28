import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage, persist } from "zustand/middleware";
import { cloneDeep } from "lodash";
import { createLogger } from "~/utils/logger";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { z } from "zod";
import { Role } from "@copilotkit/runtime-client-gql";
import { formSchema } from "~/prompt-configs/schemas";

const logger = createLogger("DraggableTabsBrowserStore");

/**
 * Zod schema for the data associated with a tab in the prompt studio browser.
 * Single Responsibility: Represents the state and metadata for a prompt tab.
 */
export const TabDataSchema = z.object({
  chat: z
    .object({
      initialMessages: z
        .array(
          z.object({
            id: z.string(),
            role: z.nativeEnum(Role),
            content: z.string(),
          }),
        )
        .default([]),
    })
    .default({
      initialMessages: [],
    }),
  form: z.object({
    currentValues: formSchema.deepPartial(),
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
 * Zod schema for a window containing multiple tabs.
 * Single Responsibility: Container for managing a collection of tabs and their active state.
 */
export const WindowSchema = z.object({
  id: z.string(),
  tabs: z.array(TabSchema),
  activeTabId: z.string().nullable(),
});
export type Window = z.infer<typeof WindowSchema>;

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
            const tabWindowIndex = state.windows.findIndex((w) =>
              w.tabs.some((t) => t.id === tabId),
            );
            const tabWindow = state.windows[tabWindowIndex];
            if (!tabWindow) return;
            const sourceTab = tabWindow.tabs.find((t) => t.id === tabId);
            if (!sourceTab) return;

            const newWindowId = `window-${Date.now()}`;
            const newTabId = `tab-${Date.now()}`;

            const newWindow: Window = {
              id: newWindowId,
              tabs: [
                {
                  id: newTabId,
                  data: {
                    form: {
                      currentValues: cloneDeep(
                        sourceTab.data.form.currentValues,
                      ),
                    },
                    meta: {
                      ...sourceTab.data.meta,
                    },
                  },
                },
              ],
              activeTabId: newTabId,
            };

            // Insert new window directly after the source window
            state.windows.splice(tabWindowIndex + 1, 0, newWindow);
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

        /**
         * Check if a tab ID is currently active.
         * Single Responsibility: Determines if the given tab is the active tab in the active window.
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
