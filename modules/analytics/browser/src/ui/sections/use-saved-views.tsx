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
import type { SavedView as StoredSavedView } from "@langwatch/dashboard-contract";
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

type ViewFilters = Partial<Record<FilterField, FilterParam>>;
type SavedViewsRouter = ReturnType<typeof useRouter>;
type SavedViewsUtils = ReturnType<typeof api.useUtils>;
type Flag = { current: boolean };

/**
 * The stored selection, read synchronously during render on a project change (not in an effect)
 * so it is available before any effect fires. React supports this pattern for derived state.
 */
function useStoredSelection(projectId: string) {
  const [selectedViewId, setSelectedViewIdState] = useState<string | null>(null);
  const skipNextMatchRef = useRef(false);
  const pendingRestoreRef = useRef(true);
  const prevProjectIdRef = useRef("");
  if (projectId && projectId !== prevProjectIdRef.current) {
    prevProjectIdRef.current = projectId;
    setSelectedViewIdState(readSelectedViewId(projectId));
    pendingRestoreRef.current = true;
    skipNextMatchRef.current = true;
  }
  return { selectedViewId, setSelectedViewIdState, skipNextMatchRef, pendingRestoreRef };
}

/** The project's saved views from the server, seeded with and written back to the local cache. */
function useCustomViews(projectId: string) {
  const cachedViews = useMemo(() => {
    if (!projectId) return undefined;
    return readCachedViews(projectId) ?? undefined;
  }, [projectId]);

  const savedViewsQuery = api.savedViews.getAll.useQuery({ projectId }, { enabled: !!projectId });
  const rawViews: StoredSavedView[] | undefined = savedViewsQuery.data;
  const isInitialized = savedViewsQuery.isFetched || cachedViews !== undefined;

  const customViews = useMemo(() => {
    if (rawViews) return rawViews.map(toClientView);
    return cachedViews ?? [];
  }, [rawViews, cachedViews]);

  useEffect(() => {
    if (!projectId || !rawViews) return;
    writeCachedViews(projectId, rawViews.map(toClientView));
  }, [projectId, rawViews]);

  return { customViews, isInitialized };
}

/** The four writes, each refreshing the list once it lands. */
function useSavedViewMutations(projectId: string, utils: SavedViewsUtils) {
  const refresh = { onSuccess: () => void utils.savedViews.getAll.invalidate({ projectId }) };
  return {
    createMutation: api.savedViews.create.useMutation(refresh),
    deleteMutation: api.savedViews.delete.useMutation(refresh),
    renameMutation: api.savedViews.rename.useMutation(refresh),
    reorderMutation: api.savedViews.reorder.useMutation(refresh),
  };
}

/** Pushing a view's filters, query and period to the address, or clearing them. */
function useViewNavigation(router: SavedViewsRouter) {
  const resetAllFilters = useCallback(() => {
    const cleanQuery = keepOnFilterReset(router.query);
    void router.push(
      { pathname: router.pathname, query: cleanQuery },
      {
        shallow: true,
        scroll: false,
      },
    );
  }, [router]);

  const applyViewFilters = useCallback(
    (viewFilters: ViewFilters, query?: string, period?: SavedView["period"]): Promise<boolean> => {
      const { startDate, endDate } = viewPeriodDates(period);
      const queryObj = buildViewQuery({
        routerQuery: router.query as Record<string, string | string[] | undefined>,
        viewFilters,
        query,
        startDate,
        endDate,
      });
      return router.push(
        { pathname: router.pathname, query: queryObj as Record<string, string | string[]> },
        { shallow: true, scroll: false },
      );
    },
    [router],
  );

  return { resetAllFilters, applyViewFilters };
}

/**
 * Pushes the stored view's filters to the URL so it's bookmarkable/shareable. useFilterParams
 * already reads the same filters from localStorage on first render, so queries fire with the
 * right filters immediately; this only syncs the URL to match.
 */
function useRestoreStoredView(input: {
  projectId: string;
  isInitialized: boolean;
  selectedViewId: string | null;
  customViews: SavedView[];
  asPath: string;
  pendingRestoreRef: Flag;
  skipNextMatchRef: Flag;
  applyViewFilters: ReturnType<typeof useViewNavigation>["applyViewFilters"];
}) {
  const { projectId, isInitialized } = input;
  useEffect(() => {
    if (!isInitialized || !projectId) return;
    input.pendingRestoreRef.current = false;
    const { selectedViewId } = input;
    if (!selectedViewId || selectedViewId === "all-traces") return;
    // The actual URL, not `filters`: useFilterParams falls back to localStorage, so `filters`
    // may be populated even when the URL itself is clean.
    if (urlCarriesViewParams(input.asPath)) return;
    const customView = input.customViews.find((v) => v.id === selectedViewId);
    if (!customView) return;
    input.skipNextMatchRef.current = true;
    void input.applyViewFilters(customView.filters, customView.query, customView.period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, projectId]);
}

/** Selecting a view by its pill; clicking the selected one returns to all traces. */
function useViewSelection(input: {
  projectId: string;
  customViews: SavedView[];
  selectedViewId: string | null;
  setSelectedViewIdState: (viewId: string | null) => void;
  skipNextMatchRef: Flag;
  navigation: ReturnType<typeof useViewNavigation>;
}) {
  const { projectId, customViews, selectedViewId, setSelectedViewIdState, skipNextMatchRef } =
    input;
  const { resetAllFilters, applyViewFilters } = input.navigation;

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
      if (!customView) return;
      setSelectedViewIdState(viewId);
      writeSelectedViewId(projectId, viewId);
      void applyViewFilters(customView.filters, customView.query, customView.period);
    },
    [
      customViews,
      projectId,
      resetAllFilters,
      applyViewFilters,
      setSelectedViewIdState,
      skipNextMatchRef,
    ],
  );

  return useCallback(
    (viewId: string) => selectView(viewId === selectedViewId ? "all-traces" : viewId),
    [selectedViewId, selectView],
  );
}

/** The optimistic row a new view shows as until the server answers with the stored one. */
function optimisticStoredView(input: {
  view: SavedView;
  projectId: string;
  order: number;
}): StoredSavedView {
  const { view, projectId, order } = input;
  return {
    id: view.id,
    projectId,
    userId: null,
    name: view.name,
    filters: view.filters,
    query: view.query ?? null,
    period: view.period ?? null,
    order,
    kind: "v1-traces-filter",
    createdAt: toDate(nowInstant()),
    updatedAt: toDate(nowInstant()),
  };
}

/** Saving the address as a view, optimistically, then pointing the selection at the stored id. */
function useSaveView(input: {
  projectId: string;
  filters: ViewFilters;
  router: SavedViewsRouter;
  utils: SavedViewsUtils;
  createMutation: ReturnType<typeof useSavedViewMutations>["createMutation"];
  setSelectedViewIdState: (viewId: string | null) => void;
}) {
  const { projectId, filters, router, utils, createMutation, setSelectedViewIdState } = input;
  return useCallback(
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

      utils.savedViews.getAll.setData({ projectId }, (old: StoredSavedView[] | undefined) =>
        old
          ? [...old, optimisticStoredView({ view: optimisticView, projectId, order: old.length })]
          : old,
      );

      createMutation.mutate(
        { projectId, name: trimmedName, filters, query: queryParam, period, scope },
        {
          onSuccess: (newView: StoredSavedView) => {
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
      setSelectedViewIdState,
    ],
  );
}

/** Deleting, renaming and reordering, each applied to the cached list before the server answers. */
function useViewEdits(input: {
  projectId: string;
  selectedViewId: string | null;
  setSelectedViewIdState: (viewId: string | null) => void;
  resetAllFilters: () => void;
  utils: SavedViewsUtils;
  mutations: ReturnType<typeof useSavedViewMutations>;
}) {
  const { projectId, selectedViewId, setSelectedViewIdState, resetAllFilters, utils } = input;
  const { deleteMutation, renameMutation, reorderMutation } = input.mutations;
  const views = utils.savedViews.getAll;

  const deleteView = useCallback(
    (viewId: string) => {
      const newSelectedId = selectedViewId === viewId ? "all-traces" : selectedViewId;
      views.setData({ projectId }, (old: StoredSavedView[] | undefined) =>
        old ? withoutView(old, viewId) : old,
      );
      setSelectedViewIdState(newSelectedId);
      writeSelectedViewId(projectId, newSelectedId);
      if (selectedViewId === viewId) resetAllFilters();
      deleteMutation.mutate({ projectId, viewId });
    },
    [selectedViewId, projectId, resetAllFilters, deleteMutation, views, setSelectedViewIdState],
  );

  const renameView = useCallback(
    (viewId: string, newName: string) => {
      const trimmedName = newName.slice(0, MAX_VIEW_NAME_LENGTH);
      views.setData({ projectId }, (old: StoredSavedView[] | undefined) =>
        old ? withViewRenamed(old, viewId, trimmedName) : old,
      );
      renameMutation.mutate({ projectId, viewId, name: trimmedName });
    },
    [projectId, renameMutation, views],
  );

  const reorderViews = useCallback(
    (newOrder: SavedView[]) => {
      const viewIds = newOrder.map((v) => v.id);
      views.setData({ projectId }, (old: StoredSavedView[] | undefined) =>
        old ? inViewOrder(old, viewIds) : old,
      );
      reorderMutation.mutate({ projectId, viewIds });
    },
    [projectId, reorderMutation, views],
  );

  return { deleteView, renameView, reorderViews };
}

/**
 * Highlights the view the address matches. Only the UI highlight: the stored selection changes
 * only through explicit pill clicks, so filters added on top of a saved view keep the default.
 */
function useMatchedViewHighlight(input: {
  filters: ViewFilters;
  query: SavedViewsRouter["query"];
  customViews: SavedView[];
  isInitialized: boolean;
  projectId: string;
  selection: ReturnType<typeof useStoredSelection>;
}) {
  const { filters, customViews, isInitialized, projectId } = input;
  const { selectedViewId, setSelectedViewIdState, skipNextMatchRef, pendingRestoreRef } =
    input.selection;
  const currentQuery = (input.query.query as string) || undefined;
  const urlStartDate = input.query.startDate as string | undefined;
  const urlEndDate = input.query.endDate as string | undefined;
  const urlHasDateParams = !!urlStartDate || !!urlEndDate;

  const matchedViewId = useMemo(
    () =>
      findMatchingView({
        currentFilters: filters,
        currentQuery,
        customViews,
        urlStartDate,
        urlEndDate,
        urlHasDateParams,
      }),
    [filters, currentQuery, customViews, urlStartDate, urlEndDate, urlHasDateParams],
  );

  useEffect(() => {
    if (!isInitialized || pendingRestoreRef.current) return;
    if (skipNextMatchRef.current) {
      skipNextMatchRef.current = false;
      return;
    }
    if (matchedViewId !== selectedViewId) setSelectedViewIdState(matchedViewId);
  }, [
    matchedViewId,
    isInitialized,
    selectedViewId,
    projectId,
    pendingRestoreRef,
    skipNextMatchRef,
    setSelectedViewIdState,
  ]);
}

function useSavedViewsInternal() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const router = useRouter();
  const { filters } = useFilterParams();
  const utils = api.useUtils();

  const selection = useStoredSelection(projectId);
  const { selectedViewId, setSelectedViewIdState, skipNextMatchRef, pendingRestoreRef } = selection;
  const { customViews, isInitialized } = useCustomViews(projectId);
  const mutations = useSavedViewMutations(projectId, utils);
  const navigation = useViewNavigation(router);

  useRestoreStoredView({
    projectId,
    isInitialized,
    selectedViewId,
    customViews,
    asPath: router.asPath,
    pendingRestoreRef,
    skipNextMatchRef,
    applyViewFilters: navigation.applyViewFilters,
  });

  const handleViewClick = useViewSelection({
    projectId,
    customViews,
    selectedViewId,
    setSelectedViewIdState,
    skipNextMatchRef,
    navigation,
  });
  const saveView = useSaveView({
    projectId,
    filters,
    router,
    utils,
    createMutation: mutations.createMutation,
    setSelectedViewIdState,
  });
  const edits = useViewEdits({
    projectId,
    selectedViewId,
    setSelectedViewIdState,
    resetAllFilters: navigation.resetAllFilters,
    utils,
    mutations,
  });

  useMatchedViewHighlight({
    filters,
    query: router.query,
    customViews,
    isInitialized,
    projectId,
    selection,
  });

  return {
    defaultViews: [{ id: "all-traces", name: "All Traces", origin: null }] as DefaultView[],
    customViews,
    selectedViewId,
    isInitialized,
    handleViewClick,
    saveView,
    ...edits,
    resetAllFilters: navigation.resetAllFilters,
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
