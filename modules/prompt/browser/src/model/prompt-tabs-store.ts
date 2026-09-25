"use client";
import { type PromptConfigFormValues } from "@langwatch/prompt-contract";
import { chatMessageSchema } from "@langwatch/trace-contract";
import { current } from "immer";
import cloneDeep from "lodash-es/cloneDeep";
import type { DeepPartial } from "react-hook-form";
import { z } from "zod";
import { create } from "zustand";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { PromptTabsCapabilities } from "./browser-capabilities.ts";
import { createTabId, createWindowId } from "./tab-id-generators.ts";

/**
 * Zod schema for the data associated with a tab in the prompt playground browser.
 * Single Responsibility: Represents the state and metadata for a prompt tab.
 */
export const TabDataSchema = z.object({
  /** When true, the tab is still fetching its data and should show a loading skeleton. */
  loading: z.boolean().optional(),
  chat: z
    .object({
      /**
       * The initial messages to display in the chat. Comes from the span data.
       */
      initialMessagesFromSpanData: z
        .array(chatMessageSchema.safeExtend({ id: z.string() }))
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
      /** When true the version history panel opens automatically when the tab mounts. */
      openHistoryOnLoad: z.boolean().optional(),
    })
    .default({
      title: null,
      versionNumber: undefined,
      scope: undefined,
    }),
  /**
   * Runtime variable values entered by the user in the Variables tab.
   * These are persisted separately from the form values.
   */
  variableValues: z.record(z.string(), z.string()).default({}),
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
 */
export interface DraggableTabsBrowserState {
  /** Array of all windows in the browser */
  windows: Window[];
  /** ID of the currently active tabbedWindow, null if no windows */
  activeWindowId: string | null;

  /** Add a new tab to the active tabbedWindow, creating one if none exists; returns its ID. */
  addTab: (params: { data: TabData }) => string;
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
  updateTabData: (params: { tabId: string; updater: (data: TabData) => TabData }) => void;
  /** Get data by tabId */
  getByTabId: (tabId: string) => TabData | undefined;
  /** Is the tab id active? Checks across all windows and tavs */
  isTabIdActive: (tabId: string) => boolean;

  /** Reset store to initial state and clear its persisted storage */
  reset: () => void;
}

const initialState = {
  windows: [],
  activeWindowId: null,
};

// Store instances cache to maintain singleton per project
const storeInstances = new Map<string, ReturnType<typeof createDraggableTabsBrowserStore>>();

/**
 * Get store instance for testing purposes.
 * Single Responsibility: Provides access to store instances for unit tests.
 */
export function getStoreForTesting({
  projectId,
  capabilities,
}: {
  projectId: string;
  capabilities: PromptTabsCapabilities;
}) {
  if (!storeInstances.has(projectId)) {
    storeInstances.set(projectId, createDraggableTabsBrowserStore(projectId, capabilities));
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

/** Slice of state that actually gets persisted (no store actions). */
type PersistedTopLevelState = Pick<DraggableTabsBrowserState, "windows" | "activeWindowId">;

/**
 * Shape written under the main storage key: tab identity/order only, no data.
 * `data` is optional purely to read the LEGACY single-key format, where each
 * tab's full `data` was embedded in the index instead of a per-tab key.
 */
interface LightTab {
  id: string;
  data?: TabData;
}
interface LightWindow {
  id: string;
  tabs: LightTab[];
  activeTabId: string;
}
interface LightPersistedState {
  windows: LightWindow[];
  activeWindowId: string | null;
}

function getTabStorageKey(projectId: string, tabId: string) {
  return `${projectId}:tab:${tabId}`;
}

/** The light index key holding tab identity/order (not per-tab data). */
function getStorageKey(projectId: string) {
  return `${projectId}:draggable-tabs-browser-store`;
}

/**
 * Removes every persisted key belonging to a project's draggable tabs browser store: each
 * per-tab `${projectId}:tab:${tabId}` key plus the light index key itself.
 */
function clearAllPersistedDataForProject(
  projectId: string,
  { storage, logger }: PromptTabsCapabilities,
) {
  const storageKey = getStorageKey(projectId);
  const tabKeyPrefix = `${projectId}:tab:`;
  try {
    const tabKeysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(tabKeyPrefix)) {
        tabKeysToRemove.push(key);
      }
    }
    for (const key of tabKeysToRemove) {
      storage.removeItem(key);
    }

    storage.removeItem(storageKey);
  } catch (error) {
    logger.error({ error, projectId }, "Failed to clear persisted store");
  }
}

/**
 * Strips transient UI flags before writing tab data to storage so they
 * don't re-trigger on page reload.
 */
function stripTransientFlags(data: TabData): TabData {
  return {
    ...data,
    meta: {
      ...data.meta,
      openHistoryOnLoad: undefined,
    },
  };
}

/** The last-persisted `data` reference per tab, so unchanged (immer-shared) tabs skip a write. */
type PersistedTabRefs = Map<string, TabData>;

/**
 * A tab's data from its own per-tab key, else the legacy embedded `data` (old single-key
 * format, so upgrading users keep their open tabs); a tab neither reads is dropped.
 */
function rehydrateTab({
  projectId,
  capabilities: { storage, logger },
  tab,
  refs,
}: {
  projectId: string;
  capabilities: PromptTabsCapabilities;
  tab: LightTab;
  refs: PersistedTabRefs;
}): { id: string; data: TabData }[] {
  const tabRaw = storage.getItem(getTabStorageKey(projectId, tab.id));
  if (tabRaw) {
    let data: TabData;
    try {
      data = JSON.parse(tabRaw) as TabData;
    } catch (parseError) {
      logger.warn(
        { tabId: tab.id, error: parseError },
        "Corrupt per-tab data during rehydration, dropping tab",
      );
      return [];
    }
    refs.set(tab.id, data);
    return [{ id: tab.id, data }];
  }
  // Legacy payload: not seeded into refs, so the next persist writes the tab's own key.
  if (tab.data) return [{ id: tab.id, data: tab.data }];
  logger.warn({ tabId: tab.id }, "Missing per-tab data key during rehydration, dropping tab");
  return [];
}

/**
 * Reference equality is enough only because this store is wrapped in Immer, which keeps an
 * unedited tab's `data` reference across `set()` calls; outside Immer it degrades to always-write.
 */
function persistTabIfChanged({
  projectId,
  storage,
  tab,
  refs,
}: {
  projectId: string;
  storage: PromptTabsCapabilities["storage"];
  tab: { id: string; data: TabData };
  refs: PersistedTabRefs;
}): void {
  if (refs.get(tab.id) === tab.data) return;
  storage.setItem(
    getTabStorageKey(projectId, tab.id),
    JSON.stringify(stripTransientFlags(tab.data)),
  );
  refs.set(tab.id, tab.data);
}

/** Removes the per-tab keys of tabs that were closed since the last persist. */
function dropClosedTabs({
  projectId,
  storage,
  currentTabIds,
  refs,
}: {
  projectId: string;
  storage: PromptTabsCapabilities["storage"];
  currentTabIds: Set<string>;
  refs: PersistedTabRefs;
}): void {
  for (const tabId of refs.keys()) {
    if (currentTabIds.has(tabId)) continue;
    storage.removeItem(getTabStorageKey(projectId, tabId));
    refs.delete(tabId);
  }
}

/**
 * Custom persist storage that splits the heavy per-tab `data` out of the single
 * windows/tabs storage key into its own key per tab (`${projectId}:tab:${tabId}`).
 */
function createTabAwarePersistStorage(
  projectId: string,
  capabilities: PromptTabsCapabilities,
): PersistStorage<PersistedTopLevelState> {
  const { storage, logger } = capabilities;
  const refs: PersistedTabRefs = new Map();

  return {
    getItem: (name) => {
      try {
        const raw = storage.getItem(name);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as {
          state: LightPersistedState;
          version?: number;
        };

        const windows: Window[] = parsed.state.windows.map((w) => ({
          id: w.id,
          activeTabId: w.activeTabId,
          tabs: w.tabs.flatMap((tab) => rehydrateTab({ projectId, capabilities, tab, refs })),
        }));

        return {
          state: {
            windows,
            activeWindowId: parsed.state.activeWindowId,
          },
          version: parsed.version,
        };
      } catch (error) {
        logger.error({ error }, "Failed to read persisted store");
        return null;
      }
    },

    setItem: (name, value: StorageValue<PersistedTopLevelState>) => {
      try {
        const currentTabIds = new Set<string>();

        const lightWindows: LightWindow[] = value.state.windows.map((w) => ({
          id: w.id,
          activeTabId: w.activeTabId,
          tabs: w.tabs.map((tab) => {
            currentTabIds.add(tab.id);
            persistTabIfChanged({ projectId, storage, tab, refs });
            return { id: tab.id };
          }),
        }));

        dropClosedTabs({ projectId, storage, currentTabIds, refs });

        const lightState: LightPersistedState = {
          windows: lightWindows,
          activeWindowId: value.state.activeWindowId,
        };

        storage.setItem(name, JSON.stringify({ state: lightState, version: value.version }));
      } catch (error) {
        logger.error({ error }, "Failed to persist store");
      }
    },

    removeItem: () => {
      // Delegate to the prefix-scan cleanup so this doesn't rely on the
      // in-memory ref map being populated — otherwise per-tab keys written
      // by another store instance (e.g. the same project open in a second
      // browser tab) would be orphaned. Also drop our own tracked refs.
      clearAllPersistedDataForProject(projectId, capabilities);
      refs.clear();
    },
  };
}

/** Index of the window whose tabs include `tabId`, or -1 if none does. */
function findWindowIndexContainingTab(windows: Window[], tabId: string): number {
  return windows.findIndex((w) => w.tabs.some((t) => t.id === tabId));
}

function createDraggableTabsBrowserStore(projectId: string, capabilities: PromptTabsCapabilities) {
  const { logger } = capabilities;
  const storageKey = getStorageKey(projectId);

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
          const tabId = createTabId();
          set((state) => {
            const newTab: Tab = { id: tabId, data };

            let activeWindow = state.windows.find((w) => w.id === state.activeWindowId);

            if (!activeWindow) {
              const windowId = createWindowId();
              activeWindow = { id: windowId, tabs: [], activeTabId: tabId };
              state.windows.push(activeWindow);
              state.activeWindowId = windowId;
            }

            activeWindow.tabs.push(newTab);
            activeWindow.activeTabId = tabId;
          });
          return tabId;
        },

        /**
         * Remove a tab by its ID and clean up empty windows.
         */
        removeTab: ({ tabId }) => {
          set((state) => {
            // Find the window containing the tab
            const windowIndex = findWindowIndexContainingTab(state.windows, tabId);

            if (windowIndex === -1) {
              logger.warn({ tabId }, "Tab not found, cannot remove");
              return;
            }

            const tabbedWindow = state.windows[windowIndex];
            if (!tabbedWindow) {
              logger.warn({ tabId }, "Tab not found, cannot remove");
              return;
            }
            const tabIndex = tabbedWindow.tabs.findIndex((tab) => tab.id === tabId);

            // Remove the tab from the window
            tabbedWindow.tabs.splice(tabIndex, 1);

            // If window is now empty, remove it entirely
            if (tabbedWindow.tabs.length === 0) {
              state.windows.splice(windowIndex, 1);

              // Activate the window that shifted into this index, or the previous one if
              // this was last.
              if (state.activeWindowId === tabbedWindow.id) {
                const nextWindow = state.windows[windowIndex] ?? state.windows[windowIndex - 1];
                state.activeWindowId = nextWindow?.id ?? null;
              }
            } else if (tabbedWindow.activeTabId === tabId) {
              // Activate the tab that shifted into this index, or the previous one if this
              // was last.
              const targetTab = tabbedWindow.tabs[tabIndex] ?? tabbedWindow.tabs[tabIndex - 1];

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
            const tabWindowIndex = findWindowIndexContainingTab(state.windows, tabId);
            const tabWindow = state.windows[tabWindowIndex];

            if (!tabWindow) {
              logger.warn({ tabId }, "Tab not found in any window, cannot split");
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
                  // sourceTab is an immer draft. current() takes a plain
                  // snapshot so no draft proxy can escape into state, and
                  // cloneDeep detaches that snapshot: current() structurally
                  // shares untouched subtrees with the base state, so the
                  // clone is what makes the split tab own its data outright.
                  data: cloneDeep(current(sourceTab).data),
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
            const sourceWindowIndex = findWindowIndexContainingTab(state.windows, tabId);

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
            if (sourceWindow.activeTabId === tabId && sourceWindow.tabs.length > 0) {
              const targetTab = sourceWindow.tabs[tabIndex] ?? sourceWindow.tabs[tabIndex - 1];
              if (targetTab) {
                sourceWindow.activeTabId = targetTab.id;
              }
            }

            // Add tab to target tabbedWindow
            const targetWindow = state.windows.find((w) => w.id === windowId);
            if (!targetWindow) {
              logger.warn({ windowId }, "Target window not found, cannot move tab");
              // Restore tab to source window
              sourceWindow.tabs.push(tabToMove);
              return;
            }

            // Clamp index to valid range
            const clampedIndex = Math.max(0, Math.min(index, targetWindow.tabs.length));
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
            state.windows = state.windows.filter((tabbedWindow) => tabbedWindow.tabs.length > 0);

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
              logger.warn({ windowId, tabId }, "Window not found, cannot set active tab");
              return;
            }

            if (!tabbedWindow.tabs.some((tab) => tab.id === tabId)) {
              logger.warn({ windowId, tabId }, "Tab not found in window, cannot set active");
              return;
            }

            tabbedWindow.activeTabId = tabId;
            state.activeWindowId = windowId;
          });
        },

        /**
         * Update tab data using an updater function for flexible partial updates.
         * @example
         * @example
         */
        updateTabData: ({ tabId, updater }) => {
          set((state) => {
            const tab = state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId);

            if (!tab) {
              logger.warn({ tabId }, "Tab not found, cannot update data");
              return;
            }

            tab.data = updater(tab.data);
          });
        },

        /**
         * Check if a tab ID is currently active.
         */
        isTabIdActive: (tabId) => {
          const state = get();
          return state.windows.some((w) => w.activeTabId === tabId);
        },

        /**
         * Reset the store to initial state and clear its persisted storage.
         * Single Responsibility: Clears all tabs and windows.
         */
        reset: () => {
          set(initialState);
          // Remove the light index key AND every per-tab key. A bare
          // removeItem(storageKey) would strand the `${projectId}:tab:*`
          // keys (the leak this store split introduced), so delegate to the
          // prefix-scan cleanup, which is robust even for per-tab keys this
          // instance never tracked in memory.
          clearAllPersistedDataForProject(projectId, capabilities);
        },

        /**
         * Get data by tabId
         */
        getByTabId: (tabId) => {
          const state = get();
          return state.windows.flatMap((w) => w.tabs).find((t) => t.id === tabId)?.data;
        },
      })),
      {
        name: storageKey,

        // Persist per-tab `data` (form values/chat/demonstrations) under its own storage key so
        // editing one tab doesn't re-serialize and write every other open tab's content. See
        // createTabAwarePersistStorage for details. Transient UI flags (meta.openHistoryOnLoad)
        // are stripped there too, right before each tab's data is written, so they don't
        // re-trigger on reload.
        partialize: (state) => ({
          windows: state.windows,
          activeWindowId: state.activeWindowId,
        }),
        storage: createTabAwarePersistStorage(projectId, capabilities),

        // Validate and handle corrupted data during rehydration
        onRehydrateStorage: () => (state, error) => {
          if (error) {
            logger.error({ error }, "Failed to rehydrate store, clearing corrupted data");
            clearAllPersistedDataForProject(projectId, capabilities);
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
              clearAllPersistedDataForProject(projectId, capabilities);
              // Reset to initial state
              Object.assign(state, initialState);
              return;
            }

            // Validate logical consistency
            let hasInconsistency = false;

            // Remove windows with no tabs
            state.windows = state.windows.filter((w) => {
              if (w.tabs.length === 0) {
                logger.warn({ windowId: w.id }, "Removing empty window during rehydration");
                hasInconsistency = true;
                return false;
              }
              return true;
            });

            // Validate each window's activeTabId exists in its tabs
            state.windows.forEach((window) => {
              const hasActiveTab = window.tabs.some((t) => t.id === window.activeTabId);
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
              const hasActiveWindow = state.windows.some((w) => w.id === state.activeWindowId);
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
              logger.warn("No valid windows after rehydration, resetting to initial state");
              Object.assign(state, initialState);
              clearAllPersistedDataForProject(projectId, capabilities);
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
 */
export function usePromptTabsStore<T>(
  {
    projectId,
    capabilities,
  }: { projectId: string | undefined; capabilities: PromptTabsCapabilities },
  selector: (state: DraggableTabsBrowserState) => T,
): T {
  const key = projectId ?? "__default__";

  // Warned unconditionally rather than only in development. A missing
  // projectId is a wiring bug in every environment — the store silently falls
  // back to a shared `__default__` key, so one project's tabs become another's
  // — and the environment read this used to guard on is not a package's to
  // make. See `environment-boundaries`.
  if (!projectId) {
    console.warn(
      `usePromptTabsStore called without projectId.
        This should not happen if used within DashboardLayout, guarantees projectId is available.`,
    );
  }

  if (!storeInstances.has(key)) {
    storeInstances.set(key, createDraggableTabsBrowserStore(key, capabilities));
  }

  const useStore = storeInstances.get(key)!;

  // Call the store hook with or without selector
  return useStore(selector);
}

/**
 * Utility to manually clear a corrupted store from storage.
 * Single Responsibility: Provides emergency recovery mechanism for corrupted store data.
 */
export function clearPromptTabsStore({
  projectId,
  capabilities,
}: {
  projectId: string;
  capabilities: PromptTabsCapabilities;
}) {
  clearAllPersistedDataForProject(projectId, capabilities);
  storeInstances.delete(projectId);
  capabilities.logger.info({ projectId }, "Cleared draggable tabs browser store");
}
