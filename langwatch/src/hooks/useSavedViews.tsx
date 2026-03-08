/**
 * React hook and context provider for managing saved views on the traces list page.
 *
 * Views are stored in the database (PostgreSQL) and shared across all team
 * members in a project via tRPC endpoints. The full views list is cached in
 * localStorage so it can be shown instantly on page load (no blink), with
 * tRPC refreshing in the background. The selected view ID is also in
 * localStorage (personal preference, not shared state).
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

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageKey(projectId: string, suffix: string): string {
  return `langwatch-saved-views-${suffix}-${projectId}`;
}

function readSelectedViewId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    // Try new key first, fall back to legacy key for migration
    return (
      localStorage.getItem(storageKey(projectId, "selected")) ??
      localStorage.getItem(`langwatch-selected-view-${projectId}`)
    );
  } catch {
    return null;
  }
}

function writeSelectedViewId(projectId: string, viewId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (viewId === null) {
      localStorage.removeItem(storageKey(projectId, "selected"));
    } else {
      localStorage.setItem(storageKey(projectId, "selected"), viewId);
    }
  } catch {
    // localStorage full or unavailable -- silently fail
  }
}

/** Cache the full views list so the bar + filters render instantly on next visit. */
function writeCachedViews(projectId: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(projectId, "cache"), JSON.stringify(views));
  } catch {
    // silently fail
  }
}

function readCachedViews(projectId: string): SavedView[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(projectId, "cache"));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

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
  const cleanQuery: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(routerQuery)) {
    if (PRESERVED_URL_KEYS.has(key)) {
      cleanQuery[key] = val;
    }
  }

  for (const [field, value] of Object.entries(viewFilters)) {
    const filterDef = availableFilters[field as FilterField];
    if (filterDef && value) {
      cleanQuery[filterDef.urlKey] = value;
    }
  }

  if (query) cleanQuery["query"] = query;
  if (startDate) cleanQuery["startDate"] = startDate;
  if (endDate) cleanQuery["endDate"] = endDate;

  return qs.stringify(cleanQuery, {
    allowDots: true,
    arrayFormat: "comma",
    allowEmptyArrays: true,
  });
}

// ---------------------------------------------------------------------------
// DB → client conversion
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useSavedViewsInternal() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const router = useRouter();
  const { filters } = useFilterParams();
  const utils = api.useContext();

  const [selectedViewId, setSelectedViewIdState] = useState<string | null>(
    null,
  );

  const skipNextMatchRef = useRef(false);
  const pendingRestoreRef = useRef(true);

  // -- Fetch saved views from DB, seeded with localStorage cache -----------
  // Read cached views once per projectId so we have instant data on mount.
  const cachedViews = useMemo(() => {
    if (!projectId) return undefined;
    const cached = readCachedViews(projectId);
    return cached ?? undefined;
  }, [projectId]);

  const savedViewsQuery = api.savedViews.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  // Combine: use server data when available, fall back to cache
  const rawViews = savedViewsQuery.data;
  const isInitialized = savedViewsQuery.isFetched || cachedViews !== undefined;

  const customViews = useMemo(() => {
    if (rawViews) return rawViews.map(toClientView);
    if (cachedViews) return cachedViews;
    return [];
  }, [rawViews, cachedViews]);

  // Write cache whenever server data arrives
  useEffect(() => {
    if (!projectId || !rawViews) return;
    const clientViews = rawViews.map(toClientView);
    writeCachedViews(projectId, clientViews);
  }, [projectId, rawViews]);

  // -- Project change: reset stale state -----------------------------------
  const prevProjectIdRef = useRef(projectId);
  useEffect(() => {
    if (!projectId) return;

    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      pendingRestoreRef.current = true;
      skipNextMatchRef.current = true;
    }

    const storedId = readSelectedViewId(projectId);
    setSelectedViewIdState(storedId);
  }, [projectId]);

  // -- tRPC mutations ------------------------------------------------------
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

  // -- Filter actions -------------------------------------------------------

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

  // -- Restore saved view on init -------------------------------------------
  useEffect(() => {
    if (!isInitialized || !projectId) return;

    pendingRestoreRef.current = false;

    if (!selectedViewId || selectedViewId === "all-traces") return;

    // Only restore when there are no existing filter params in the URL
    const hasUrlFilters = Object.values(filters).some((v) => {
      const norm = normalizeFilterValue(v);
      return norm !== undefined;
    });
    const hasUrlQuery = !!router.query.query;
    if (hasUrlFilters || hasUrlQuery) return;

    const customView = customViews.find((v) => v.id === selectedViewId);
    if (customView) {
      skipNextMatchRef.current = true;
      applyViewFilters(customView.filters, customView.query, customView.period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, projectId]);

  // -- View selection -------------------------------------------------------

  const selectView = useCallback(
    (viewId: string) => {
      skipNextMatchRef.current = true;

      if (viewId === "all-traces") {
        setSelectedViewIdState("all-traces");
        writeSelectedViewId(projectId, "all-traces");
        resetAllFilters();
        return;
      }

      const customView = customViews.find((v) => v.id === viewId);
      if (customView) {
        setSelectedViewIdState(viewId);
        writeSelectedViewId(projectId, viewId);
        applyViewFilters(customView.filters, customView.query, customView.period);
      }
    },
    [customViews, projectId, resetAllFilters, applyViewFilters],
  );

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

  // -- Save / delete / rename / reorder -------------------------------------

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

      const tempId = `temp-${Date.now()}`;
      const optimisticView: SavedView = {
        id: tempId,
        name: trimmedName,
        filters: { ...filters },
        query: queryParam,
        ...(period ? { period } : {}),
      };

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

      setSelectedViewIdState(tempId);
      return optimisticView;
    },
    [filters, router.query.query, router.query.startDate, router.query.endDate, projectId, createMutation, utils.savedViews.getAll],
  );

  const deleteView = useCallback(
    (viewId: string) => {
      const newSelectedId =
        selectedViewId === viewId ? "all-traces" : selectedViewId;

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

  const renameView = useCallback(
    (viewId: string, newName: string) => {
      const trimmedName = newName.slice(0, MAX_VIEW_NAME_LENGTH);

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

  const reorderViews = useCallback(
    (newOrder: SavedView[]) => {
      const viewIds = newOrder.map((v) => v.id);

      utils.savedViews.getAll.setData({ projectId }, (old) => {
        if (!old) return old;
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

  // -- View matching --------------------------------------------------------

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

  useEffect(() => {
    if (!isInitialized) return;
    if (pendingRestoreRef.current) return;

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
  }, [matchedViewId, isInitialized, selectedViewId, projectId]);

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

export function useSavedViews(): SavedViewsContextValue {
  const context = useContext(SavedViewsContext);
  if (!context) {
    throw new Error("useSavedViews must be used within a SavedViewsProvider");
  }
  return context;
}
