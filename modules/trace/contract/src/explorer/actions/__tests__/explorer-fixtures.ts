import type { ExplorerState } from "../transforms/types.ts";

export const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

/** A settled Explorer on the default lens, with nothing searched. */
export function explorerState(overrides: Partial<ExplorerState> = {}): ExplorerState {
  return {
    queryText: "",
    timeRange: {
      from: NOW - 30 * 24 * 3_600_000,
      to: NOW,
      label: "Last 30 days",
      presetId: "30d",
    },
    activeLensId: "all-traces",
    sort: { columnId: "time", direction: "desc" },
    grouping: "flat",
    columnOrder: ["time", "trace", "duration"],
    page: 1,
    pageSize: 50,
    selection: { mode: "explicit", traceIds: new Set<string>() },
    expandedRows: new Set<string>(),
    evalRuns: {},
    ...overrides,
  };
}
