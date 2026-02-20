/**
 * Zustand store for suite run history view state.
 *
 * Manages groupBy mode and filter state, with URL synchronization
 * so that view state persists across page reloads.
 *
 * The store is the single source of truth. Components read from the store,
 * and the URL is a serialized view of the store state.
 */

import { create } from "zustand";
import { RUN_GROUP_TYPES, type RunGroupType } from "./run-history-transforms";

function isValidGroupBy(value: unknown): value is RunGroupType {
  return (
    typeof value === "string" &&
    (RUN_GROUP_TYPES as readonly string[]).includes(value)
  );
}

type FilterKey = "scenarioId" | "passFailStatus";

interface Filters {
  scenarioId: string;
  passFailStatus: string;
}

/** Minimal router interface for URL sync (avoids coupling to Next.js router) */
interface RouterLike {
  query: Record<string, string | string[] | undefined>;
  push: (
    url: { query: Record<string, string> },
    as?: undefined,
    options?: { shallow: boolean },
  ) => void;
}

/** Query object shape from Next.js router.query */
type QueryLike = Record<string, string | string[] | undefined>;

export interface RunHistoryState {
  groupBy: RunGroupType;
  filters: Filters;
  setGroupBy: (value: RunGroupType) => void;
  setFilter: (key: FilterKey, value: string) => void;
  syncToUrl: (router: RouterLike) => void;
  hydrateFromUrl: (query: QueryLike) => void;
}

function extractStringParam(
  query: QueryLike,
  key: string,
): string {
  const value = query[key];
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
}

/**
 * Creates a fresh store instance. Exported for testing (each test gets its own store).
 * Components should use the default `useRunHistoryStore` hook below.
 */
export function createRunHistoryStore() {
  return create<RunHistoryState>((set, get) => ({
    groupBy: "none",
    filters: {
      scenarioId: "",
      passFailStatus: "",
    },

    setGroupBy: (value: RunGroupType) => {
      set({ groupBy: value });
    },

    setFilter: (key: FilterKey, value: string) => {
      set((state) => ({
        filters: { ...state.filters, [key]: value },
      }));
    },

    syncToUrl: (router: RouterLike) => {
      const { groupBy, filters } = get();
      const query: Record<string, string> = {};

      // Preserve existing query params (e.g., project slug in URL)
      for (const [key, val] of Object.entries(router.query)) {
        if (typeof val === "string") {
          query[key] = val;
        }
      }

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

      router.push({ query }, undefined, { shallow: true });
    },

    hydrateFromUrl: (query: QueryLike) => {
      const groupByParam = extractStringParam(query, "groupBy");

      set({
        groupBy: isValidGroupBy(groupByParam) ? groupByParam : "none",
        filters: {
          scenarioId: extractStringParam(query, "scenarioId"),
          passFailStatus: extractStringParam(query, "passFailStatus"),
        },
      });
    },
  }));
}

/** Singleton store for use in React components */
export const useRunHistoryStore = createRunHistoryStore();
