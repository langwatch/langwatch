/**
 * React hook and context provider for managing saved views on the traces list page. Views are
 * stored in the database (PostgreSQL) and shared across all team members in a project via tRPC
 * endpoints.
 */

import {
  availableFilters,
  type FilterField,
  type FilterParam,
  useFilterParams,
} from "@langwatch/analytics-browser-kit";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { nowInstant, toDate } from "@langwatch/time";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type DefaultView,
  findMatchingView,
  inViewOrder,
  keepOnFilterReset,
  MAX_VIEW_NAME_LENGTH,
  periodFromUrlDates,
  type SavedView,
  urlCarriesViewParams,
  viewPeriodDates,
  withoutView,
  withViewRenamed,
} from "./saved-views-logic.ts";

// Re-export types and constants for consumers
export {
  DEFAULT_VIEWS,
  type DefaultView,
  MAX_VIEW_NAME_LENGTH,
  SAVED_VIEWS_SCHEMA_VERSION,
  type SavedView,
} from "./saved-views-logic.ts";

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
    // silently fail
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

/**
 * Builds a Next.js query object for router.push({ query }). Preserves layout keys (view,
 * group_by) and date params from the current URL, then overlays the view's filters, query, and
 * optional date overrides.
 */
function buildViewQuery({
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
}): Record<string, unknown> {
  const KEEP = new Set(["project", "view", "group_by", "startDate", "endDate", "negateFilters"]);

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(routerQuery)) {
    if (KEEP.has(key)) {
      out[key] = val;
    }
  }

  // Overlay filter URL params
  for (const [field, value] of Object.entries(viewFilters)) {
    const filterDef = availableFilters[field as FilterField];
    if (filterDef && value) {
      out[filterDef.urlKey] = value;
    }
  }

  if (query) out.query = query;
  if (startDate) out.startDate = startDate;
  if (endDate) out.endDate = endDate;

  return out;
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
  const utils = api.useUtils();

  const [selectedViewId, setSelectedViewIdState] = useState<string | null>(null);

  const skipNextMatchRef = useRef(false);
  const pendingRestoreRef = useRef(true);

  // -- Read selectedViewId synchronously on projectId change ----------------
  // This runs during render (not in an effect) so selectedViewId is available
  // before any effects fire. React supports this pattern for derived state.
  const prevProjectIdRef = useRef("");
  if (projectId && projectId !== prevProjectIdRef.current) {
    prevProjectIdRef.current = projectId;
    const storedId = readSelectedViewId(projectId);
    setSelectedViewIdState(storedId);
    pendingRestoreRef.current = true;
    skipNextMatchRef.current = true;
  }

  // -- Fetch saved views from DB, seeded with localStorage cache -----------
  const cachedViews = useMemo(() => {
    if (!projectId) return undefined;
    const cached = readCachedViews(projectId);
    return cached ?? undefined;
  }, [projectId]);

  const savedViewsQuery = api.savedViews.getAll.useQuery({ projectId }, { enabled: !!projectId });

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
    const cleanQuery = keepOnFilterReset(router.query);
    void router.push({ pathname: router.pathname, query: cleanQuery }, undefined, {
      shallow: true,
      scroll: false,
    });
  }, [router]);

  const applyViewFilters = useCallback(
    (
      viewFilters: Partial<Record<FilterField, FilterParam>>,
      query?: string,
      period?: SavedView["period"],
    ): Promise<boolean> => {
      const { startDate, endDate } = viewPeriodDates(period);

      const queryObj = buildViewQuery({
        routerQuery: router.query as Record<string, string | string[] | undefined>,
        viewFilters,
        query,
        startDate,
        endDate,
      });

      return router.push(
        {
          pathname: router.pathname,
          query: queryObj as Record<string, string | string[]>,
        },
        undefined,
        { shallow: true, scroll: false },
      );
    },
    [router],
  );

  // -- Restore saved view on init -------------------------------------------
  // Pushes the stored view's filters to the URL so it's bookmarkable/shareable.
  // Note: useFilterParams already reads the same filters from localStorage on
  // first render, so queries fire with correct filters immediately. This effect
  // just syncs the URL to match.
  useEffect(() => {
    if (!isInitialized || !projectId) return;

    pendingRestoreRef.current = false;

    if (!selectedViewId || selectedViewId === "all-traces") return;

    // Only restore when there are no filter/date/query params in the actual URL.
    // We check router.asPath (not `filters` from useFilterParams) because
    // useFilterParams now includes a localStorage fallback — so `filters` may
    // be populated even when the URL itself is clean.
    if (urlCarriesViewParams(router.asPath)) return;

    const customView = customViews.find((v: any) => v.id === selectedViewId);
    if (customView) {
      skipNextMatchRef.current = true;
      void applyViewFilters(customView.filters, customView.query, customView.period);
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

      const customView = customViews.find((v: any) => v.id === viewId);
      if (customView) {
        setSelectedViewIdState(viewId);
        writeSelectedViewId(projectId, viewId);
        void applyViewFilters(customView.filters, customView.query, customView.period);
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

      const period = periodFromUrlDates({
        startDate: router.query.startDate as string | undefined,
        endDate: router.query.endDate as string | undefined,
      });

      const tempId = `temp-${nowInstant().epochMilliseconds}`;
      const optimisticView: SavedView = {
        id: tempId,
        name: trimmedName,
        filters: { ...filters },
        query: queryParam,
        ...(period ? { period } : {}),
      };

      utils.savedViews.getAll.setData({ projectId }, (old: any) => {
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
            createdAt: toDate(nowInstant()),
            updatedAt: toDate(nowInstant()),
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
          onSuccess: (newView: { id: string }) => {
            setSelectedViewIdState(newView.id);
            writeSelectedViewId(projectId, newView.id);
          },
        },
      );

      setSelectedViewIdState(tempId);
      return optimisticView;
    },
    [
      filters,
      router.query.query,
      router.query.startDate,
      router.query.endDate,
      projectId,
      createMutation,
      utils.savedViews.getAll,
    ],
  );

  const deleteView = useCallback(
    (viewId: string) => {
      const newSelectedId = selectedViewId === viewId ? "all-traces" : selectedViewId;

      utils.savedViews.getAll.setData({ projectId }, (old: any) =>
        old ? withoutView(old, viewId) : old,
      );

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

      utils.savedViews.getAll.setData({ projectId }, (old: any) =>
        old ? withViewRenamed(old, viewId, trimmedName) : old,
      );

      renameMutation.mutate({ projectId, viewId, name: trimmedName });
    },
    [projectId, renameMutation, utils.savedViews.getAll],
  );

  const reorderViews = useCallback(
    (newOrder: SavedView[]) => {
      const viewIds = newOrder.map((v) => v.id);

      utils.savedViews.getAll.setData({ projectId }, (old: any) =>
        old ? inViewOrder(old, viewIds) : old,
      );

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

    // Only update the UI highlight — don't persist to localStorage.
    // The stored selection should only change via explicit pill clicks
    // (handleViewClick/selectView), so adding extra filters on top of a
    // saved view doesn't lose the user's default selection.
    if (matchedViewId !== selectedViewId) {
      setSelectedViewIdState(matchedViewId);
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

export function SavedViewsProvider({ children }: { children: React.ReactNode }) {
  const value = useSavedViewsInternal();
  return <SavedViewsContext.Provider value={value}>{children}</SavedViewsContext.Provider>;
}

export function useSavedViews(): SavedViewsContextValue {
  const context = useContext(SavedViewsContext);
  if (!context) {
    throw new Error("useSavedViews must be used within a SavedViewsProvider");
  }
  return context;
}
