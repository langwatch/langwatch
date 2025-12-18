/**
 * DataGrid URL Query Params Utilities
 *
 * Provides functions to sync DataGrid state to/from URL query params.
 * Uses `qs` library for handling nested objects (filters array).
 *
 * Why custom serialization instead of raw qs.stringify?
 * - Omits default values for cleaner URLs (?page=2 vs ?page=2&pageSize=20)
 * - Flat sortBy/sortOrder instead of nested sorting[columnId]/sorting[order]
 * - Renames globalSearch → search for cleaner URLs
 * - Uses native browser APIs (window.location, history.replaceState)
 */
import qs from "qs";
import type { FilterState, SortingState } from "./types";

/**
 * State fields that can be synced to URL
 */
interface URLSyncState {
  filters: FilterState[];
  sorting: SortingState | null;
  page: number;
  pageSize: number;
  globalSearch: string;
  groupBy: string | null;
}

/**
 * Default values for URL-synced state
 */
const DEFAULTS: URLSyncState = {
  filters: [],
  sorting: null,
  page: 1,
  pageSize: 20,
  globalSearch: "",
  groupBy: null,
};

/**
 * Parse URL search params into DataGrid state
 */
function parse(searchParams: string): Partial<URLSyncState> {
  if (!searchParams) {
    return {};
  }

  const parsed = qs.parse(searchParams, {
    ignoreQueryPrefix: true,
    arrayLimit: 100,
  });

  const result: Partial<URLSyncState> = {};

  // Parse filters array
  if (parsed.filters && Array.isArray(parsed.filters)) {
    result.filters = parsed.filters
      .filter((f): f is qs.ParsedQs => typeof f === "object" && f !== null)
      .map((f) => ({
        columnId: String(f["columnId"] ?? ""),
        operator: (f["operator"] as FilterState["operator"]) ?? "eq",
        value: f["value"],
      }))
      .filter((f) => f.columnId);
  }

  // Parse sorting (flat params)
  if (parsed.sortBy && typeof parsed.sortBy === "string") {
    const order =
      parsed.sortOrder === "asc" || parsed.sortOrder === "desc"
        ? parsed.sortOrder
        : "desc";
    result.sorting = { columnId: parsed.sortBy, order };
  }

  // Parse pagination
  if (parsed.page) {
    const page = parseInt(String(parsed.page), 10);
    if (!isNaN(page) && page > 0) {
      result.page = page;
    }
  }

  if (parsed.pageSize) {
    const pageSize = parseInt(String(parsed.pageSize), 10);
    if (!isNaN(pageSize) && pageSize > 0 && pageSize <= 100) {
      result.pageSize = pageSize;
    }
  }

  // Parse search (renamed from globalSearch)
  if (parsed.search && typeof parsed.search === "string") {
    result.globalSearch = parsed.search;
  }

  // Parse groupBy
  if (parsed.groupBy && typeof parsed.groupBy === "string") {
    result.groupBy = parsed.groupBy;
  }

  return result;
}

/**
 * Serialize DataGrid state to URL search params.
 * Only includes non-default values to keep URLs clean.
 */
function serialize(state: Partial<URLSyncState>): string {
  const params: Record<string, unknown> = {};

  if (state.filters && state.filters.length > 0) {
    params.filters = state.filters.map((f) => ({
      columnId: f.columnId,
      operator: f.operator,
      value: f.value,
    }));
  }

  // Flat sortBy/sortOrder instead of nested
  if (state.sorting) {
    params.sortBy = state.sorting.columnId;
    params.sortOrder = state.sorting.order;
  }

  if (state.page && state.page !== DEFAULTS.page) {
    params.page = state.page;
  }

  if (state.pageSize && state.pageSize !== DEFAULTS.pageSize) {
    params.pageSize = state.pageSize;
  }

  // Renamed: globalSearch → search
  if (state.globalSearch) {
    params.search = state.globalSearch;
  }

  if (state.groupBy) {
    params.groupBy = state.groupBy;
  }

  return qs.stringify(params, {
    arrayFormat: "indices",
    encode: true,
  });
}

/**
 * Merge URL state with existing state. URL takes priority.
 */
function merge(
  urlState: Partial<URLSyncState>,
  existingState: Partial<URLSyncState>
): URLSyncState {
  return {
    filters: urlState.filters ?? existingState.filters ?? DEFAULTS.filters,
    sorting: urlState.sorting ?? existingState.sorting ?? DEFAULTS.sorting,
    page: urlState.page ?? existingState.page ?? DEFAULTS.page,
    pageSize: urlState.pageSize ?? existingState.pageSize ?? DEFAULTS.pageSize,
    globalSearch:
      urlState.globalSearch ??
      existingState.globalSearch ??
      DEFAULTS.globalSearch,
    groupBy: urlState.groupBy ?? existingState.groupBy ?? DEFAULTS.groupBy,
  };
}

/**
 * Check if state fields have changed
 */
function hasChanged(
  newState: Partial<URLSyncState>,
  oldState: Partial<URLSyncState>
): boolean {
  return (
    JSON.stringify(newState.filters) !== JSON.stringify(oldState.filters) ||
    JSON.stringify(newState.sorting) !== JSON.stringify(oldState.sorting) ||
    newState.page !== oldState.page ||
    newState.pageSize !== oldState.pageSize ||
    newState.globalSearch !== oldState.globalSearch ||
    newState.groupBy !== oldState.groupBy
  );
}

/**
 * Read current URL state from browser.
 * Safe for SSR - returns empty object if window is undefined.
 */
function readFromURL(): Partial<URLSyncState> {
  if (typeof window === "undefined") {
    return {};
  }
  return parse(window.location.search);
}

/**
 * Write state to URL using native history.replaceState.
 * Preserves other query params not managed by DataGrid.
 * Safe for SSR - no-op if window is undefined.
 */
function writeToURL(
  state: Partial<URLSyncState>,
  preserveParams: string[] = ["view"]
): void {
  if (typeof window === "undefined") {
    return;
  }

  const currentParams = new URLSearchParams(window.location.search);
  const newStateParams = serialize(state);
  const newParams = new URLSearchParams(newStateParams);

  // Preserve specified params from current URL
  for (const key of preserveParams) {
    const value = currentParams.get(key);
    if (value !== null) {
      newParams.set(key, value);
    }
  }

  const newUrl = new URL(window.location.href);
  newUrl.search = newParams.toString();

  window.history.replaceState(null, "", newUrl.toString());
}

/**
 * DataGrid URL Query Params Utilities
 *
 * Single export for all URL sync functionality.
 * Uses custom serialization for cleaner URLs (see module comment).
 */
export const DataGridUrlParams = {
  /** Parse URL search string into state */
  parse,
  /** Serialize state to URL search string */
  serialize,
  /** Merge URL state with existing state (URL priority) */
  merge,
  /** Check if state has changed */
  hasChanged,
  /** Read state from current browser URL */
  readFromURL,
  /** Write state to browser URL */
  writeToURL,
  /** Default values */
  DEFAULTS,
} as const;
