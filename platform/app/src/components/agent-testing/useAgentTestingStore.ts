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

/** The case the editor dialog is open on, if any. */
export type CaseEditorTarget = {
  open: boolean;
  /** The case being edited, or nothing for a new one. */
  scenarioId: string | null;
  /** The suite a new case starts in. */
  folderId: string | null;
};

const CLOSED_CASE_EDITOR: CaseEditorTarget = {
  open: false,
  scenarioId: null,
  folderId: null,
};

export interface AgentTestingState {
  viewMode: AgentTestingViewMode;
  railCollapsed: boolean;
  expandedFolderIds: Set<string>;
  /** The target the last run used, so the run dialog opens on it again. */
  lastRunTarget: TargetValue;
  /** A run that was just started and has no rows yet. */
  pendingBatchRunId: string | null;
  /** The run whose cancel is in flight, so its button can say so. */
  cancellingJobId: string | null;
  caseEditor: CaseEditorTarget;

  setViewMode: (value: AgentTestingViewMode) => void;
  setRailCollapsed: (isCollapsed: boolean) => void;
  toggleRailCollapsed: () => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  toggleFolder: (folderId: string) => void;
  setLastRunTarget: (target: TargetValue) => void;
  setPendingBatchRunId: (batchRunId: string | null) => void;
  setCancellingJobId: (jobId: string | null) => void;
  openCaseEditor: (target: Partial<Omit<CaseEditorTarget, "open">>) => void;
  closeCaseEditor: () => void;

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
    pendingBatchRunId: null,
    cancellingJobId: null,
    caseEditor: CLOSED_CASE_EDITOR,

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

    setPendingBatchRunId: (batchRunId) =>
      set({ pendingBatchRunId: batchRunId }),

    setCancellingJobId: (jobId) => set({ cancellingJobId: jobId }),

    openCaseEditor: ({ scenarioId = null, folderId = null }) =>
      set({ caseEditor: { open: true, scenarioId, folderId } }),

    closeCaseEditor: () => set({ caseEditor: CLOSED_CASE_EDITOR }),

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
