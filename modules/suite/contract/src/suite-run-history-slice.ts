/**
 * The run-history view state the global UI store holds under `suite:run-history`.
 * Suite writes it; any module may read it (ARCHITECTURE §10.2).
 */

export const RUN_HISTORY_SLICE = "suite:run-history";

/** How the run history may be grouped. */
export const RUN_GROUP_TYPES = ["none", "scenario", "target"] as const;

export type RunGroupType = (typeof RUN_GROUP_TYPES)[number];

export type RunHistoryFilterKey = "scenarioId" | "passFailStatus";

export interface RunHistoryFilters {
  scenarioId: string;
  passFailStatus: string;
}

/** Minimal router interface for URL sync (avoids coupling to a router). */
export interface RunHistoryRouterLike {
  query: Record<string, string | string[] | undefined>;
  push: (url: { query: Record<string, string | string[]> }, options?: { shallow: boolean }) => void;
}

export type RunHistoryQueryLike = Record<string, string | string[] | undefined>;

export type ViewMode = "grid" | "list";

export interface RunHistoryState {
  groupBy: RunGroupType;
  viewMode: ViewMode;
  filters: RunHistoryFilters;
  setGroupBy: (value: RunGroupType) => void;
  setViewMode: (value: ViewMode) => void;
  setFilter: (key: RunHistoryFilterKey, value: string) => void;
  setFilters: (filters: RunHistoryFilters) => void;
  syncToUrl: (router: RunHistoryRouterLike) => void;
  hydrateFromUrl: (query: RunHistoryQueryLike) => void;
}

const nothing = (): void => {};

/** What a reader sees where suite is not installed: the defaults, and every write a no-op. */
export const RUN_HISTORY_ABSENT: RunHistoryState = {
  groupBy: "none",
  viewMode: "grid",
  filters: { scenarioId: "", passFailStatus: "" },
  setGroupBy: nothing,
  setViewMode: nothing,
  setFilter: nothing,
  setFilters: nothing,
  syncToUrl: nothing,
  hydrateFromUrl: nothing,
};
