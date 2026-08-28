/**
 * Ephemeral view state for the Agent Testing page.
 *
 * The address holds everything a person can link to (tab, suite, plan, run,
 * period). This store holds what only this browser cares about: how the
 * results are drawn, whether the rail is folded, which folders are open, and
 * the run that was just started but has no rows yet.
 *
 * The view mode is the exception: it is written to the address as `?view=` so
 * a shared link opens the same way. The store stays the single source of
 * truth and the address is a serialized view of it, the same contract
 * useRunHistoryStore keeps.
 */

import { create } from "zustand";
import type { TargetValue } from "~/components/scenarios/TargetSelector";

export const AGENT_TESTING_RAIL_COLLAPSED_KEY =
  "agent-testing-rail-collapsed" as const;

export type AgentTestingViewMode = "table" | "grid";

const VIEW_MODES: readonly AgentTestingViewMode[] = ["table", "grid"];

function isViewMode(value: unknown): value is AgentTestingViewMode {
  return (
    typeof value === "string" &&
    (VIEW_MODES as readonly string[]).includes(value)
  );
}

/** Minimal router shape for address sync, so the store stays router agnostic. */
interface RouterLike {
  query: Record<string, string | string[] | undefined>;
  push: (
    url: { query: Record<string, string | string[]> },
    as?: undefined,
    options?: { shallow: boolean },
  ) => void;
}

type QueryLike = Record<string, string | string[] | undefined>;

/**
 * A run that was just started and has no rows yet. The set it belongs to
 * travels with it, so only the run plan that started it shows the entry.
 */
export type PendingRun = {
  batchRunId: string;
  scenarioSetId: string;
};

/**
 * The run plan the Results tab is open on, as the page title reads it. The
 * page header is above the tab that resolves the plan, so the tab hands the
 * title up rather than the header reading the plans a second time.
 */
export type OpenPlanTitle = {
  name: string;
  /** What the plan is: "Test suite", "from code", and so on. */
  note: string;
};

export interface AgentTestingState {
  viewMode: AgentTestingViewMode;
  railCollapsed: boolean;
  expandedFolderIds: Set<string>;
  /** The target the last run used, so the run dialog opens on it again. */
  lastRunTarget: TargetValue;
  pendingRun: PendingRun | null;
  /** The run whose cancel is in flight, so its button can say so. */
  cancellingJobId: string | null;
  /** The run plan the page is open on, or nothing on the list itself. */
  openPlanTitle: OpenPlanTitle | null;

  setViewMode: (value: AgentTestingViewMode) => void;
  setRailCollapsed: (isCollapsed: boolean) => void;
  toggleRailCollapsed: () => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  toggleFolder: (folderId: string) => void;
  setLastRunTarget: (target: TargetValue) => void;
  setPendingRun: (run: PendingRun | null) => void;
  setCancellingJobId: (jobId: string | null) => void;
  setOpenPlanTitle: (title: OpenPlanTitle | null) => void;

  syncToUrl: (router: RouterLike) => void;
  hydrateFromUrl: (query: QueryLike) => void;
}

function readStoredRailCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(AGENT_TESTING_RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function storeRailCollapsed(isCollapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AGENT_TESTING_RAIL_COLLAPSED_KEY, String(isCollapsed));
  } catch {
    // localStorage unavailable
  }
}

/**
 * Every param the address already carries, including the route params the
 * catch-all page needs ("project" and the "path" array).
 */
function carryQueryParams(query: QueryLike): Record<string, string | string[]> {
  const carried: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" || Array.isArray(value)) {
      carried[key] = value;
    }
  }
  return carried;
}

function extractStringParam(query: QueryLike, key: string): string {
  const value = query[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

/**
 * Creates a fresh store. Exported so a test gets its own instance; components
 * use the shared `useAgentTestingStore` below.
 */
export function createAgentTestingStore() {
  return create<AgentTestingState>((set, get) => ({
    viewMode: "table",
    railCollapsed: readStoredRailCollapsed(),
    expandedFolderIds: new Set<string>(),
    lastRunTarget: null,
    pendingRun: null,
    cancellingJobId: null,
    openPlanTitle: null,

    setViewMode: (value) => set({ viewMode: value }),

    setRailCollapsed: (isCollapsed) => {
      storeRailCollapsed(isCollapsed);
      set({ railCollapsed: isCollapsed });
    },

    toggleRailCollapsed: () => {
      const next = !get().railCollapsed;
      storeRailCollapsed(next);
      set({ railCollapsed: next });
    },

    setFolderExpanded: (folderId, expanded) => {
      set((state) => {
        const next = new Set(state.expandedFolderIds);
        if (expanded) next.add(folderId);
        else next.delete(folderId);
        return { expandedFolderIds: next };
      });
    },

    toggleFolder: (folderId) => {
      set((state) => {
        const next = new Set(state.expandedFolderIds);
        if (next.has(folderId)) next.delete(folderId);
        else next.add(folderId);
        return { expandedFolderIds: next };
      });
    },

    setLastRunTarget: (target) => set({ lastRunTarget: target }),

    setPendingRun: (run) => set({ pendingRun: run }),

    setCancellingJobId: (jobId) => set({ cancellingJobId: jobId }),

    setOpenPlanTitle: (title) => set({ openPlanTitle: title }),

    syncToUrl: (router) => {
      const { viewMode } = get();
      const query = carryQueryParams(router.query);

      if (viewMode === "table") {
        delete query.view;
      } else {
        query.view = viewMode;
      }

      router.push({ query }, undefined, { shallow: true });
    },

    hydrateFromUrl: (query) => {
      const view = extractStringParam(query, "view");
      set({ viewMode: isViewMode(view) ? view : "table" });
    },
  }));
}

/** Shared store for the page. */
export const useAgentTestingStore = createAgentTestingStore();
