/**
 * React hook and context provider for managing saved views on the traces list page.
 *
 * Views are stored in the database (PostgreSQL) and shared across all team
 * members in a project via tRPC endpoints. The selected view ID is stored in
 * localStorage per user (personal preference, not shared state).
 *
 * Pure logic functions (matching, normalization) live in savedViewsLogic.ts
 * to enable unit testing without server dependencies.
 *
 * Use SavedViewsProvider at the page level, then useSavedViews() in any
 * child component to access shared state (SavedViewsBar, SaveAsViewButton, etc.)
 */

import { differenceInCalendarDays, subDays } from "date-fns";
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
import { api } from "../utils/api";
import type { FilterParam } from "./useFilterParams";
import { useFilterParams } from "./useFilterParams";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { availableFilters } from "../server/filters/registry";
import type { FilterField } from "../server/filters/types";
import {
  DEFAULT_VIEWS,
  findMatchingView,
  MAX_VIEW_NAME_LENGTH,
  normalizeFilterValue,
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
} from "./savedViewsLogic";

/** URL query keys to preserve when applying or resetting view filters */
const PRESERVED_URL_KEYS = new Set([
  "project",
  "view",
  "group_by",
  "startDate",
  "endDate",
  "negateFilters",
]);

/**
 * Reads the selected view ID from localStorage for a project.
 */
function readSelectedViewId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(`langwatch-selected-view-${projectId}`);
  } catch {
    return null;
  }
}

/**
 * Writes the selected view ID to localStorage for a project.
 */
function writeSelectedViewId(
  projectId: string,
  viewId: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    if (viewId === null) {
      localStorage.removeItem(`langwatch-selected-view-${projectId}`);
    } else {
      localStorage.setItem(`langwatch-selected-view-${projectId}`, viewId);
    }
  } catch {
    // localStorage full or unavailable -- silently fail
  }
}

/**
 * Builds URL query params for a set of view filters and optional search query,
 * preserving non-filter keys like project, view, and group_by.
 */
function buildViewQueryString({
  routerQuery,
  viewFilters,
  query,
  startDate,
  endDate,
}: {
  routerQuery: Record<string, string | string[] | undefined>;
  viewFilters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
  startDate?: string;
  endDate?: string;
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

  if (startDate) {
    cleanQuery["startDate"] = startDate;
  }
  if (endDate) {
    cleanQuery["endDate"] = endDate;
  }

  return qs.stringify(cleanQuery, {
    allowDots: true,
    arrayFormat: "comma",
    allowEmptyArrays: true,
  });
}

/**
 * Converts a DB saved view record to the client-side SavedView shape.
 * The DB stores filters/period as Json; we need to cast them properly.
 */
function toClientView(dbView: {
  id: string;
  name: string;
  userId?: string | null;
  filters: unknown;
  query: string | null;
  period: unknown;
}): SavedView {
  return {
    id: dbView.id,
    name: dbView.name,
    userId: dbView.userId,
    filters: (dbView.filters ?? {}) as Partial<Record<FilterField, FilterParam>>,
    query: dbView.query ?? undefined,
    period: dbView.period as SavedView["period"],
  };
}

/**
 * Internal hook providing saved views functionality.
 * Do not call directly -- use useSavedViews() via SavedViewsProvider instead.
 */
function useSavedViewsInternal() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const router = useRouter();
  const { filters } = useFilterParams();
  const utils = api.useContext();

  const [selectedViewId, setSelectedViewIdState] = useState<string | null>(
    null,
  );

  // Track whether we should skip the next filter-change matching cycle
  // (because we ourselves just applied filters)
  const skipNextMatchRef = useRef(false);

  // Fetch saved views from database
  const savedViewsQuery = api.savedViews.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const isInitialized = savedViewsQuery.isFetched;

  // Convert DB views to client shape
  const customViews = useMemo(() => {
    if (!savedViewsQuery.data) return [];
    return savedViewsQuery.data.map(toClientView);
  }, [savedViewsQuery.data]);

  // Reset state and load selectedViewId on project change
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (!projectId) return;

    // When switching projects, clear stale state so old views aren't briefly applied
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      skipNextMatchRef.current = true;
    }

    const storedId = readSelectedViewId(projectId);
    setSelectedViewIdState(storedId);
  }, [projectId]);

  // tRPC mutations
  const createMutation = api.savedViews.create.useMutation({
    onSuccess: () => {
      void utils.savedViews.getAll.invalidate({ projectId });
    },
  });
  const deleteMutation = api.savedViews.delete.useMutation({
    onSuccess: () => {
      void utils.savedViews.getAll.invalidate({ projectId });
    },
  });
  const renameMutation = api.savedViews.rename.useMutation({
    onSuccess: () => {
      void utils.savedViews.getAll.invalidate({ projectId });
    },
  });
  const reorderMutation = api.savedViews.reorder.useMutation({
    onSuccess: () => {
      void utils.savedViews.getAll.invalidate({ projectId });
    },
  });

  /**
   * Resets all filters including query and negateFilters.
   * Preserves date window so the time picker doesn't reset.
   */
  const resetAllFilters = useCallback(() => {
    const RESET_PRESERVED = new Set(["project", "view", "group_by", "startDate", "endDate"]);
    const cleanQuery = Object.fromEntries(
      Object.entries(router.query).filter(([key]) =>
        RESET_PRESERVED.has(key),
      ),
    );

    void router.push({ query: cleanQuery }, undefined, {
      shallow: true,
      scroll: false,
    });
  }, [router]);

  /**
   * Applies a set of filters, optional query string, and optional period to the URL.
   */
  const applyViewFilters = useCallback(
    (
      viewFilters: Partial<Record<FilterField, FilterParam>>,
      query?: string,
      period?: SavedView["period"],
    ) => {
      let startDate: string | undefined;
      let endDate: string | undefined;

      if (period) {
        if (period.relativeDays !== undefined) {
          endDate = new Date().toISOString();
          startDate = subDays(new Date(), period.relativeDays - 1).toISOString();
        } else if (period.startDate && period.endDate) {
          startDate = period.startDate;
          endDate = period.endDate;
        }
      }

      const queryString = buildViewQueryString({
        routerQuery: router.query as Record<
          string,
          string | string[] | undefined
        >,
        viewFilters,
        query,
        startDate,
        endDate,
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

    const customView = customViews.find((v) => v.id === selectedViewId);
    if (customView) {
      skipNextMatchRef.current = true;
      applyViewFilters(customView.filters, customView.query, customView.period);
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
        writeSelectedViewId(projectId, "all-traces");
        resetAllFilters();
        return;
      }

      // Check custom views (includes seeded origin views)
      const customView = customViews.find((v) => v.id === viewId);
      if (customView) {
        setSelectedViewIdState(viewId);
        writeSelectedViewId(projectId, viewId);
        applyViewFilters(customView.filters, customView.query, customView.period);
      }
    },
    [
      customViews,
      projectId,
      resetAllFilters,
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
   * Captures date period from URL if present.
   * @param scope - "project" (shared) or "myself" (personal). Defaults to "project".
   */
  const saveView = useCallback(
    (name: string, scope: "project" | "myself" = "project") => {
      const trimmedName = name.slice(0, MAX_VIEW_NAME_LENGTH);
      const queryParam = (router.query.query as string) || undefined;

      let period: SavedView["period"] | undefined;
      const startDateStr = router.query.startDate as string | undefined;
      const endDateStr = router.query.endDate as string | undefined;

      if (startDateStr && endDateStr) {
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        const daysDifference = differenceInCalendarDays(endDate, startDate) + 1;
        const endIsRecent = differenceInCalendarDays(new Date(), endDate) <= 1;

        if (endIsRecent) {
          period = { relativeDays: daysDifference };
        } else {
          period = { startDate: startDateStr, endDate: endDateStr };
        }
      }

      // Optimistic update: add view to cache immediately
      const tempId = `temp-${Date.now()}`;
      const optimisticView: SavedView = {
        id: tempId,
        name: trimmedName,
        filters: { ...filters },
        query: queryParam,
        ...(period ? { period } : {}),
      };

      // Optimistically add to the list
      utils.savedViews.getAll.setData({ projectId }, (old) => {
        if (!old) return old;
        return [
          ...old,
          {
            ...optimisticView,
            projectId,
            filters: optimisticView.filters as Record<string, unknown>,
            period: optimisticView.period ?? null,
            query: optimisticView.query ?? null,
            order: old.length,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as (typeof old)[number],
        ];
      });

      createMutation.mutate(
        {
          projectId,
          name: trimmedName,
          filters: filters as Record<string, unknown>,
          query: queryParam,
          period,
          scope,
        },
        {
          onSuccess: (newView) => {
            setSelectedViewIdState(newView.id);
            writeSelectedViewId(projectId, newView.id);
          },
        },
      );

      // Set temp selection immediately for snappy UI
      setSelectedViewIdState(tempId);

      return optimisticView;
    },
    [filters, router.query.query, router.query.startDate, router.query.endDate, projectId, createMutation, utils.savedViews.getAll],
  );

  /**
   * Deletes a custom view by ID.
   */
  const deleteView = useCallback(
    (viewId: string) => {
      const newSelectedId =
        selectedViewId === viewId ? "all-traces" : selectedViewId;

      // Optimistic update
      utils.savedViews.getAll.setData({ projectId }, (old) => {
        if (!old) return old;
        return old.filter((v) => v.id !== viewId);
      });

      setSelectedViewIdState(newSelectedId);
      writeSelectedViewId(projectId, newSelectedId);

      if (selectedViewId === viewId) {
        resetAllFilters();
      }

      deleteMutation.mutate({ projectId, viewId });
    },
    [selectedViewId, projectId, resetAllFilters, deleteMutation, utils.savedViews.getAll],
  );

  /**
   * Renames a custom view.
   */
  const renameView = useCallback(
    (viewId: string, newName: string) => {
      const trimmedName = newName.slice(0, MAX_VIEW_NAME_LENGTH);

      // Optimistic update
      utils.savedViews.getAll.setData({ projectId }, (old) => {
        if (!old) return old;
        return old.map((v) =>
          v.id === viewId ? { ...v, name: trimmedName } : v,
        );
      });

      renameMutation.mutate({ projectId, viewId, name: trimmedName });
    },
    [projectId, renameMutation, utils.savedViews.getAll],
  );

  /**
   * Reorders custom views.
   */
  const reorderViews = useCallback(
    (newOrder: SavedView[]) => {
      const viewIds = newOrder.map((v) => v.id);

      // Optimistic update
      utils.savedViews.getAll.setData({ projectId }, (old) => {
        if (!old) return old;
        // Reorder the existing data to match newOrder
        const viewMap = new Map(old.map((v) => [v.id, v]));
        return viewIds
          .map((id, index) => {
            const view = viewMap.get(id);
            if (!view) return null;
            return { ...view, order: index };
          })
          .filter(Boolean) as typeof old;
      });

      reorderMutation.mutate({ projectId, viewIds });
    },
    [projectId, reorderMutation, utils.savedViews.getAll],
  );

  // View matching: compare current filters against all views on every change
  const currentQuery = (router.query.query as string) || undefined;
  const urlStartDate = router.query.startDate as string | undefined;
  const urlEndDate = router.query.endDate as string | undefined;
  const urlHasDateParams = !!urlStartDate || !!urlEndDate;

  const matchedViewId = useMemo(() => {
    return findMatchingView({
      currentFilters: filters,
      currentQuery,
      customViews,
      urlStartDate,
      urlEndDate,
      urlHasDateParams,
    });
  }, [filters, currentQuery, customViews, urlStartDate, urlEndDate, urlHasDateParams]);

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
        writeSelectedViewId(projectId, matchedViewId);
      }
    }
  }, [
    matchedViewId,
    isInitialized,
    selectedViewId,
    projectId,
  ]);

  return {
    defaultViews: [{ id: "all-traces", name: "All Traces", origin: null }] as DefaultView[],
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
