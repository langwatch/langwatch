// Run history view state with groupBy and filters, synced to URL.

import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  RUN_GROUP_TYPES,
  RUN_HISTORY_SLICE,
  type RunGroupType,
  type RunHistoryFilterKey,
  type RunHistoryFilters,
  type RunHistoryQueryLike,
  type RunHistoryRouterLike,
  type RunHistoryState,
  type ViewMode,
} from "@langwatch/suite-contract";

export type { RunHistoryState, ViewMode };

function isValidGroupBy(value: unknown): value is RunGroupType {
  return typeof value === "string" && (RUN_GROUP_TYPES as readonly string[]).includes(value);
}

function copyDefinedQueryParams(source: RunHistoryQueryLike): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, val] of Object.entries(source)) {
    if (typeof val === "string") {
      query[key] = val;
    } else if (Array.isArray(val)) {
      query[key] = val;
    }
  }
  return query;
}

function extractStringParam(query: RunHistoryQueryLike, key: string): string {
  const value = query[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

/**
 * Creates a fresh store instance. Exported for testing (each test gets its own store).
 * Components should use the default `useRunHistoryStore` hook below.
 */
export function createRunHistoryStore() {
  return defineSlice<RunHistoryState>({
    name: RUN_HISTORY_SLICE,
    create: (set, get) => ({
      groupBy: "none",
      viewMode: "grid",
      filters: {
        scenarioId: "",
        passFailStatus: "",
      },

      setGroupBy: (value: RunGroupType) => {
        set({ groupBy: value });
      },

      setViewMode: (value: ViewMode) => {
        set({ viewMode: value });
      },

      setFilter: (key: RunHistoryFilterKey, value: string) => {
        set((state) => ({
          filters: { ...state.filters, [key]: value },
        }));
      },

      setFilters: (filters: RunHistoryFilters) => {
        set({ filters });
      },

      syncToUrl: (router: RunHistoryRouterLike) => {
        const { groupBy, filters } = get();

        // Preserve all existing query params (including dynamic path params
        // like "project" and array params like "path" for catch-all routes).
        const query = copyDefinedQueryParams(router.query);

        // Serialize groupBy (omit when "none")
        if (groupBy !== "none") {
          query.groupBy = groupBy;
        } else {
          delete query.groupBy;
        }

        // Serialize filters (omit empty values)
        if (filters.scenarioId) {
          query.scenarioId = filters.scenarioId;
        } else {
          delete query.scenarioId;
        }

        if (filters.passFailStatus) {
          query.passFailStatus = filters.passFailStatus;
        } else {
          delete query.passFailStatus;
        }

        router.push({ query }, { shallow: true });
      },

      hydrateFromUrl: (query: RunHistoryQueryLike) => {
        const groupByParam = extractStringParam(query, "groupBy");

        set({
          groupBy: isValidGroupBy(groupByParam) ? groupByParam : "none",
          filters: {
            scenarioId: extractStringParam(query, "scenarioId"),
            passFailStatus: extractStringParam(query, "passFailStatus"),
          },
        });
      },
    }),
  });
}

/** The run-history slice (`suite:run-history`); suite owns the writes. */
export const useRunHistoryStore = createRunHistoryStore();
