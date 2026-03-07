/**
 * Pure logic functions for saved views feature.
 *
 * Separated from the React hook to enable unit testing without
 * importing React or server-side dependencies (Prisma, registry).
 */

import type { FilterParam } from "./useFilterParams";
import type { FilterField } from "../server/filters/types";

/** Maximum allowed length for a view name */
export const MAX_VIEW_NAME_LENGTH = 50;

/** Schema version for localStorage migration support */
export const SAVED_VIEWS_SCHEMA_VERSION = 1;

/** Represents a single saved view (custom, not default) */
export interface SavedView {
  id: string;
  name: string;
  filters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
}

/** Shape of data stored in localStorage */
export interface SavedViewsStorage {
  schemaVersion: number;
  views: SavedView[];
  selectedViewId: string | null;
}

/** Default view definition with display metadata */
export interface DefaultView {
  id: string;
  name: string;
  origin: string | null; // null means "All Traces" (no filter)
}

/** All default views, always present and non-deletable */
export const DEFAULT_VIEWS: DefaultView[] = [
  { id: "all-traces", name: "All Traces", origin: null },
  { id: "application", name: "Application", origin: "application" },
  { id: "evaluations", name: "Evaluations", origin: "evaluation" },
  { id: "simulations", name: "Simulations", origin: "simulation" },
  { id: "playground", name: "Playground", origin: "playground" },
];

/**
 * Returns the localStorage key for a given project ID.
 */
export function getStorageKey(projectId: string): string {
  return `langwatch-saved-views-${projectId}`;
}

/**
 * Reads saved views from localStorage, returning defaults on failure.
 */
export function readSavedViewsFromStorage(
  projectId: string,
): SavedViewsStorage {
  const defaultData: SavedViewsStorage = {
    schemaVersion: SAVED_VIEWS_SCHEMA_VERSION,
    views: [],
    selectedViewId: null,
  };

  if (typeof window === "undefined") return defaultData;

  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (!raw) return defaultData;

    const parsed = JSON.parse(raw) as SavedViewsStorage;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.schemaVersion !== "number" ||
      !Array.isArray(parsed.views)
    ) {
      // Corrupt data -- replace with defaults
      localStorage.setItem(
        getStorageKey(projectId),
        JSON.stringify(defaultData),
      );
      return defaultData;
    }

    // Filter out malformed view objects
    const validViews = parsed.views.filter(
      (v: unknown): v is SavedView =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as SavedView).id === "string" &&
        typeof (v as SavedView).name === "string" &&
        typeof (v as SavedView).filters === "object" &&
        (v as SavedView).filters !== null,
    );

    return {
      schemaVersion: parsed.schemaVersion,
      views: validViews,
      selectedViewId: parsed.selectedViewId ?? null,
    };
  } catch {
    // Unparseable -- replace with fresh defaults
    localStorage.setItem(
      getStorageKey(projectId),
      JSON.stringify(defaultData),
    );
    return defaultData;
  }
}

/**
 * Writes saved views to localStorage.
 */
export function writeSavedViewsToStorage(
  projectId: string,
  data: SavedViewsStorage,
): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(getStorageKey(projectId), JSON.stringify(data));
  } catch {
    // localStorage full or unavailable -- silently fail
  }
}

/**
 * Normalizes a filter value for comparison.
 * - Arrays are sorted for order-insensitive matching
 * - undefined/null/empty arrays are treated as absent
 * - Nested objects have their arrays sorted recursively
 */
export function normalizeFilterValue(
  value: FilterParam | undefined,
): FilterParam | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return [...value].sort();
  }

  // Record<string, string[] | Record<string, string[]>>
  const entries = Object.entries(value)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return null;
        return [k, [...v].sort()] as const;
      }
      // Nested record
      const innerEntries = Object.entries(v as Record<string, string[]>)
        .map(([ik, iv]) => {
          if (Array.isArray(iv) && iv.length === 0) return null;
          return [ik, Array.isArray(iv) ? [...iv].sort() : iv] as const;
        })
        .filter(Boolean) as [string, string[]][];

      if (innerEntries.length === 0) return null;
      return [k, Object.fromEntries(innerEntries)] as const;
    })
    .filter(Boolean) as [string, FilterParam][];

  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.sort(([a], [b]) => a.localeCompare(b)),
  ) as FilterParam;
}

/**
 * Compares two filter states for equality.
 * Order-insensitive for arrays, normalizes empty values.
 */
export function filtersMatch(
  a: Partial<Record<FilterField, FilterParam>>,
  b: Partial<Record<FilterField, FilterParam>>,
): boolean {
  const allKeys = new Set([
    ...Object.keys(a),
    ...Object.keys(b),
  ]) as Set<FilterField>;

  for (const key of allKeys) {
    const normA = normalizeFilterValue(a[key]);
    const normB = normalizeFilterValue(b[key]);

    if (normA === undefined && normB === undefined) continue;
    if (normA === undefined || normB === undefined) return false;

    if (JSON.stringify(normA) !== JSON.stringify(normB)) return false;
  }

  return true;
}

/**
 * Finds which view (default or custom) matches the current filter state.
 * Returns the view ID if matched, null otherwise.
 */
export function findMatchingView({
  currentFilters,
  currentQuery,
  customViews,
}: {
  currentFilters: Partial<Record<FilterField, FilterParam>>;
  currentQuery: string | undefined;
  customViews: SavedView[];
}): string | null {
  const normalizedQuery = currentQuery || undefined;

  // Check "All Traces" -- no filters, no query
  const hasFilters = Object.values(currentFilters).some((v) => {
    const norm = normalizeFilterValue(v);
    return norm !== undefined;
  });

  if (!hasFilters && !normalizedQuery) {
    return "all-traces";
  }

  // Check default origin views
  for (const view of DEFAULT_VIEWS) {
    if (view.origin === null) continue; // Already checked "all-traces"

    const viewFilters: Partial<Record<FilterField, FilterParam>> = {
      "traces.origin": [view.origin],
    };

    if (filtersMatch(currentFilters, viewFilters) && !normalizedQuery) {
      return view.id;
    }
  }

  // Check custom views
  for (const view of customViews) {
    if (
      filtersMatch(currentFilters, view.filters) &&
      (normalizedQuery ?? undefined) === (view.query ?? undefined)
    ) {
      return view.id;
    }
  }

  return null;
}

/**
 * Generates a unique ID for a new custom view.
 */
export function generateViewId(): string {
  return `view-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
