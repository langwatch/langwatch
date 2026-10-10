/**
 * Ephemeral view state for the Agent Testing page.
 */

import { defineSlice } from "@langwatch/browser-host/global-store";

import type { TargetValue } from "../../model/scenario-target.ts";

export type AgentTestingViewMode = "table" | "grid";

const VIEW_MODES: readonly AgentTestingViewMode[] = ["table", "grid"];

function isViewMode(value: unknown): value is AgentTestingViewMode {
  return typeof value === "string" && (VIEW_MODES as readonly string[]).includes(value);
}

/** Minimal router shape for address sync, so the store stays router agnostic. */
interface RouterLike {
  query: Record<string, string | string[] | undefined>;
  push: (url: { query: Record<string, string | string[]> }, options?: { shallow: boolean }) => void;
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
  expandedTestSuiteIds: Set<string>;
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
  setTestSuiteExpanded: (testSuiteId: string, expanded: boolean) => void;
  toggleTestSuite: (testSuiteId: string) => void;
  setLastRunTarget: (target: TargetValue) => void;
  setPendingRun: (run: PendingRun | null) => void;
  setCancellingJobId: (jobId: string | null) => void;
  setOpenPlanTitle: (title: OpenPlanTitle | null) => void;

  syncToUrl: (router: RouterLike) => void;
  hydrateFromUrl: (query: QueryLike) => void;
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

/** The page's view state; only the rail pick persists, per reader (§10.2). */
export const useAgentTestingStore = defineSlice<AgentTestingState>({
  name: "scenario:agent-testing",
  persist: { partialize: ({ railCollapsed }) => ({ railCollapsed }) },
  create: (set, get) => ({
    viewMode: "table",
    railCollapsed: false,
    expandedTestSuiteIds: new Set<string>(),
    lastRunTarget: null,
    pendingRun: null,
    cancellingJobId: null,
    openPlanTitle: null,

    setViewMode: (value) => set({ viewMode: value }),

    setRailCollapsed: (isCollapsed) => set({ railCollapsed: isCollapsed }),

    toggleRailCollapsed: () => set({ railCollapsed: !get().railCollapsed }),

    setTestSuiteExpanded: (testSuiteId, expanded) => {
      set((state) => {
        return {
          expandedTestSuiteIds: expandedTestSuites(
            state.expandedTestSuiteIds,
            testSuiteId,
            expanded,
          ),
        };
      });
    },

    toggleTestSuite: (testSuiteId) => {
      set((state) => {
        return {
          expandedTestSuiteIds: expandedTestSuites(
            state.expandedTestSuiteIds,
            testSuiteId,
            !state.expandedTestSuiteIds.has(testSuiteId),
          ),
        };
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

      router.push({ query }, { shallow: true });
    },

    hydrateFromUrl: (query) => {
      const view = extractStringParam(query, "view");
      set({ viewMode: isViewMode(view) ? view : "table" });
    },
  }),
});

function expandedTestSuites(
  current: Set<string>,
  testSuiteId: string,
  expanded: boolean,
): Set<string> {
  const next = new Set(current);
  if (expanded) {
    next.add(testSuiteId);
  } else {
    next.delete(testSuiteId);
  }
  return next;
}
