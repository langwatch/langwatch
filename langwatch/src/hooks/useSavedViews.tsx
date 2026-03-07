/**
 * React hook and context provider for managing saved views on the traces list page.
 *
 * Pure logic functions (localStorage, matching, normalization) live in
 * savedViewsLogic.ts to enable unit testing without server dependencies.
 *
 * Use SavedViewsProvider at the page level, then useSavedViews() in any
 * child component to access shared state (SavedViewsBar, SaveAsViewButton, etc.)
 */

import { useRouter } from "next/router";
import qs from "qs";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilterParam } from "./useFilterParams";
import { useFilterParams } from "./useFilterParams";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { availableFilters } from "../server/filters/registry";
import type { FilterField } from "../server/filters/types";
import {
  DEFAULT_VIEWS,
  findMatchingView,
  generateViewId,
  MAX_VIEW_NAME_LENGTH,
  normalizeFilterValue,
  readSavedViewsFromStorage,
  SAVED_VIEWS_SCHEMA_VERSION,
  writeSavedViewsToStorage,
  type DefaultView,
  type SavedView,
} from "./savedViewsLogic";

// Re-export types and constants for consumers
export {
  DEFAULT_VIEWS,
  MAX_VIEW_NAME_LENGTH,
  SAVED_VIEWS_SCHEMA_VERSION,
  type DefaultView,
  type SavedView,
  type SavedViewsStorage,
} from "./savedViewsLogic";

/** URL query keys to preserve when applying or resetting view filters */
const PRESERVED_URL_KEYS = new Set(["project", "view", "group_by"]);

/**
 * Builds URL query params for a set of view filters and optional search query,
 * preserving non-filter keys like project, view, and group_by.
 */
function buildViewQueryString({
  routerQuery,
  viewFilters,
  query,
}: {
  routerQuery: Record<string, string | string[] | undefined>;
  viewFilters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
}): string {
  // Start with only preserved keys
  const cleanQuery: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(routerQuery)) {
    if (PRESERVED_URL_KEYS.has(key)) {
      cleanQuery[key] = val;
    }
  }

  // Build filter URL params
  for (const [field, value] of Object.entries(viewFilters)) {
    const filterDef = availableFilters[field as FilterField];
    if (filterDef && value) {
      cleanQuery[filterDef.urlKey] = value;
    }
  }

  if (query) {
    cleanQuery["query"] = query;
  }

  return qs.stringify(cleanQuery, {
    allowDots: true,
    arrayFormat: "comma",
    // @ts-expect-error -- qs types are missing allowEmptyArrays option
    allowEmptyArrays: true,
  });
}

/**
 * Internal hook providing saved views functionality.
 * Do not call directly — use useSavedViews() via SavedViewsProvider instead.
 */
function useSavedViewsInternal() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const router = useRouter();
  const { filters, setFilters } = useFilterParams();

  const [customViews, setCustomViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewIdState] = useState<string | null>(
    null,
  );
  const [isInitialized, setIsInitialized] = useState(false);

  // Track whether we should skip the next filter-change matching cycle
  // (because we ourselves just applied filters)
  const skipNextMatchRef = useRef(false);

  // Load from localStorage on mount / project change
  useEffect(() => {
    if (!projectId) return;

    const stored = readSavedViewsFromStorage(projectId);
    setCustomViews(stored.views);
    setSelectedViewIdState(stored.selectedViewId);
    setIsInitialized(true);
  }, [projectId]);

  // Persist to localStorage whenever custom views or selection changes
  const persistToStorage = useCallback(
    (views: SavedView[], viewId: string | null) => {
      if (!projectId) return;
      writeSavedViewsToStorage(projectId, {
        schemaVersion: SAVED_VIEWS_SCHEMA_VERSION,
        views,
        selectedViewId: viewId,
      });
    },
    [projectId],
  );

  /**
   * Resets all filters including query and negateFilters.
   * Goes beyond clearFilters() which only handles field filters.
   */
  const resetAllFilters = useCallback(() => {
    const cleanQuery = Object.fromEntries(
      Object.entries(router.query).filter(([key]) =>
        PRESERVED_URL_KEYS.has(key),
      ),
    );

    void router.push({ query: cleanQuery }, undefined, {
      shallow: true,
      scroll: false,
    });
  }, [router]);

  /**
   * Applies a set of filters and optionally a query string to the URL.
   */
  const applyViewFilters = useCallback(
    (
      viewFilters: Partial<Record<FilterField, FilterParam>>,
      query?: string,
    ) => {
      const queryString = buildViewQueryString({
        routerQuery: router.query as Record<
          string,
          string | string[] | undefined
        >,
        viewFilters,
        query,
      });

      void router.push("?" + queryString, undefined, {
        shallow: true,
        scroll: false,
      });
    },
    [router],
  );

  // On init, restore the selected view's filters if we have one
  useEffect(() => {
    if (!isInitialized || !projectId || !selectedViewId) return;

    // Only restore on initial load when there are no existing filter params
    const hasUrlFilters = Object.values(filters).some((v) => {
      const norm = normalizeFilterValue(v);
      return norm !== undefined;
    });
    const hasUrlQuery = !!router.query.query;

    if (hasUrlFilters || hasUrlQuery) return;

    // Restore the selected view's filters
    if (selectedViewId === "all-traces") return;

    const defaultView = DEFAULT_VIEWS.find((v) => v.id === selectedViewId);
    if (defaultView?.origin) {
      skipNextMatchRef.current = true;
      setFilters({
        "traces.origin": [defaultView.origin],
      } as Record<FilterField, FilterParam>);
      return;
    }

    const customView = customViews.find((v) => v.id === selectedViewId);
    if (customView) {
      skipNextMatchRef.current = true;
      applyViewFilters(customView.filters, customView.query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, projectId]);

  /**
   * Selects a view and applies its filters.
   */
  const selectView = useCallback(
    (viewId: string) => {
      skipNextMatchRef.current = true;

      if (viewId === "all-traces") {
        setSelectedViewIdState("all-traces");
        persistToStorage(customViews, "all-traces");
        resetAllFilters();
        return;
      }

      // Check default views
      const defaultView = DEFAULT_VIEWS.find((v) => v.id === viewId);
      if (defaultView?.origin) {
        setSelectedViewIdState(viewId);
        persistToStorage(customViews, viewId);
        setFilters({
          "traces.origin": [defaultView.origin],
        } as Record<FilterField, FilterParam>);
        return;
      }

      // Check custom views
      const customView = customViews.find((v) => v.id === viewId);
      if (customView) {
        setSelectedViewIdState(viewId);
        persistToStorage(customViews, viewId);
        applyViewFilters(customView.filters, customView.query);
      }
    },
    [
      customViews,
      persistToStorage,
      resetAllFilters,
      setFilters,
      applyViewFilters,
    ],
  );

  /**
   * Handles clicking a view badge.
   * If the clicked view is already selected, deselects it (selects All Traces).
   */
  const handleViewClick = useCallback(
    (viewId: string) => {
      if (viewId === selectedViewId) {
        selectView("all-traces");
      } else {
        selectView(viewId);
      }
    },
    [selectedViewId, selectView],
  );

  /**
   * Saves the current filter state as a new custom view.
   */
  const saveView = useCallback(
    (name: string) => {
      const trimmedName = name.slice(0, MAX_VIEW_NAME_LENGTH);
      const queryParam = (router.query.query as string) || undefined;

      const newView: SavedView = {
        id: generateViewId(),
        name: trimmedName,
        filters: { ...filters },
        query: queryParam,
      };

      const updatedViews = [...customViews, newView];
      setCustomViews(updatedViews);
      setSelectedViewIdState(newView.id);
      persistToStorage(updatedViews, newView.id);

      return newView;
    },
    [filters, router.query.query, customViews, persistToStorage],
  );

  /**
   * Deletes a custom view by ID.
   */
  const deleteView = useCallback(
    (viewId: string) => {
      const updatedViews = customViews.filter((v) => v.id !== viewId);
      const newSelectedId =
        selectedViewId === viewId ? "all-traces" : selectedViewId;

      setCustomViews(updatedViews);
      setSelectedViewIdState(newSelectedId);
      persistToStorage(updatedViews, newSelectedId);

      if (selectedViewId === viewId) {
        resetAllFilters();
      }
    },
    [customViews, selectedViewId, persistToStorage, resetAllFilters],
  );

  /**
   * Renames a custom view.
   */
  const renameView = useCallback(
    (viewId: string, newName: string) => {
      const trimmedName = newName.slice(0, MAX_VIEW_NAME_LENGTH);
      const updatedViews = customViews.map((v) =>
        v.id === viewId ? { ...v, name: trimmedName } : v,
      );

      setCustomViews(updatedViews);
      persistToStorage(updatedViews, selectedViewId);
    },
    [customViews, selectedViewId, persistToStorage],
  );

  /**
   * Reorders custom views.
   */
  const reorderViews = useCallback(
    (newOrder: SavedView[]) => {
      setCustomViews(newOrder);
      persistToStorage(newOrder, selectedViewId);
    },
    [selectedViewId, persistToStorage],
  );

  // View matching: compare current filters against all views on every change
  const currentQuery = (router.query.query as string) || undefined;

  const matchedViewId = useMemo(() => {
    return findMatchingView({
      currentFilters: filters,
      currentQuery,
      customViews,
    });
  }, [filters, currentQuery, customViews]);

  // Auto-update selectedViewId when filters change (view matching)
  useEffect(() => {
    if (!isInitialized) return;

    if (skipNextMatchRef.current) {
      skipNextMatchRef.current = false;
      return;
    }

    if (matchedViewId !== selectedViewId) {
      setSelectedViewIdState(matchedViewId);
      if (projectId) {
        persistToStorage(customViews, matchedViewId);
      }
    }
  }, [
    matchedViewId,
    isInitialized,
    selectedViewId,
    customViews,
    projectId,
    persistToStorage,
  ]);

  return {
    defaultViews: DEFAULT_VIEWS,
    customViews,
    selectedViewId,
    isInitialized,
    handleViewClick,
    saveView,
    deleteView,
    renameView,
    reorderViews,
    resetAllFilters,
  };
}

type SavedViewsContextValue = ReturnType<typeof useSavedViewsInternal>;

const SavedViewsContext = createContext<SavedViewsContextValue | null>(null);

/**
 * Provider that shares saved views state across components.
 * Wrap this around the page so SavedViewsBar and SaveAsViewButton
 * share the same hook instance instead of maintaining separate state.
 */
export function SavedViewsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useSavedViewsInternal();
  return (
    <SavedViewsContext.Provider value={value}>
      {children}
    </SavedViewsContext.Provider>
  );
}

/**
 * Access shared saved views state. Must be used within SavedViewsProvider.
 */
export function useSavedViews(): SavedViewsContextValue {
  const context = useContext(SavedViewsContext);
  if (!context) {
    throw new Error("useSavedViews must be used within a SavedViewsProvider");
  }
  return context;
}
