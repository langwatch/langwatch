/**
 * Pure logic functions for saved views, separated from the React hook so
 * they unit-test without importing React or server-side dependencies
 * (Prisma, registry).
 */

import type { FilterField, FilterParam } from "@langwatch/analytics-browser-kit";
import { differenceInCalendarDays, nowInstant, subDays } from "@langwatch/time";

import { availableFilters } from "../../model/analytics-filter-catalogue.ts";

/** Maximum allowed length for a view name */
export const MAX_VIEW_NAME_LENGTH = 50;

/** Schema version for localStorage selectedViewId migration support */
export const SAVED_VIEWS_SCHEMA_VERSION = 1;

/** Represents a single saved view (custom, not default) */
export interface SavedView {
  id: string;
  name: string;
  /** When set, this is a personal view visible only to that user */
  userId?: string | null;
  filters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
  /**
   * Saved date period. `relativeDays` = rolling window (e.g. 30 = "Last 30 days").
   * Fixed `startDate`/`endDate` ISO strings for custom date ranges.
   * Omitted when the view uses the default period.
   */
  period?: {
    relativeDays?: number;
    startDate?: string;
    endDate?: string;
  };
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
  { id: "gateway", name: "Gateway", origin: "gateway" },
];

/**
 * Normalizes a filter value for comparison: arrays sort for
 * order-insensitive matching, undefined/null/empty arrays count as
 * absent, and nested objects sort their arrays recursively.
 */
export function normalizeFilterValue(value: FilterParam | undefined): FilterParam | undefined {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return [...value].toSorted();
  }

  // Record<string, string[] | Record<string, string[]>>
  const entries = Object.entries(value).flatMap(([k, v]) => normalizeFilterEntry(k, v));

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.toSorted(([a], [b]) => a.localeCompare(b))) as FilterParam;
}

function normalizeFilterEntry(
  key: string,
  entryValue: string[] | Record<string, string[]>,
): [string, FilterParam][] {
  if (Array.isArray(entryValue)) {
    if (entryValue.length === 0) return [];
    return [[key, [...entryValue].toSorted((a, b) => (a < b ? -1 : Number(a > b)))]];
  }
  const innerEntries = normalizeNestedFilterEntries(entryValue);
  if (innerEntries.length === 0) return [];
  return [[key, Object.fromEntries(innerEntries.toSorted(([a], [b]) => a.localeCompare(b)))]];
}

function normalizeNestedFilterEntries(record: Record<string, string[]>): [string, string[]][] {
  return Object.entries(record).flatMap(([innerKey, innerValue]): [string, string[]][] => {
    if (Array.isArray(innerValue) && innerValue.length === 0) return [];
    return [[innerKey, Array.isArray(innerValue) ? [...innerValue].toSorted() : innerValue]];
  });
}

/**
 * Compares two filter states for equality.
 * Order-insensitive for arrays, normalizes empty values.
 */
export function filtersMatch(
  a: Partial<Record<FilterField, FilterParam>>,
  b: Partial<Record<FilterField, FilterParam>>,
): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<FilterField>;

  for (const key of allKeys) {
    const normA = normalizeFilterValue(a[key]);
    const normB = normalizeFilterValue(b[key]);

    if (normA === undefined && normB === undefined) continue;
    if (normA === undefined || normB === undefined) return false;

    const isSameValue = JSON.stringify(normA) === JSON.stringify(normB);
    if (!isSameValue) return false;
  }

  return true;
}

/**
 * Checks whether a view's saved period matches the current URL date state.
 */
export function periodMatches({
  viewPeriod,
  urlStartDate,
  urlEndDate,
  urlHasDateParams,
}: {
  viewPeriod: SavedView["period"];
  urlStartDate: string | undefined;
  urlEndDate: string | undefined;
  urlHasDateParams: boolean;
}): boolean {
  // Views without a period match regardless of current dates
  if (!viewPeriod) return true;

  // Views WITH a period only match when the URL also has date params
  if (!urlHasDateParams) return false;

  if (viewPeriod.relativeDays !== undefined) {
    if (!urlStartDate || !urlEndDate) return false;
    const daysDiff = differenceInCalendarDays(urlEndDate, urlStartDate) + 1;
    const endIsRecent = differenceInCalendarDays(nowInstant().epochMilliseconds, urlEndDate) <= 1;
    return daysDiff === viewPeriod.relativeDays && endIsRecent;
  }

  if (viewPeriod.startDate && viewPeriod.endDate) {
    return urlStartDate === viewPeriod.startDate && urlEndDate === viewPeriod.endDate;
  }

  return false;
}

/**
 * Finds which view (default or custom) matches the current filter state.
 * Returns the view ID if matched, null otherwise.
 */
export function findMatchingView({
  currentFilters,
  currentQuery,
  customViews,
  urlStartDate,
  urlEndDate,
  urlHasDateParams = false,
}: {
  currentFilters: Partial<Record<FilterField, FilterParam>>;
  currentQuery: string | undefined;
  customViews: SavedView[];
  urlStartDate?: string;
  urlEndDate?: string;
  urlHasDateParams?: boolean;
}): string | null {
  const normalizedQuery = currentQuery || undefined;

  // Check "All Traces" -- no filters, no query, no date params
  const hasFilters = Object.values(currentFilters).some((v) => {
    const norm = normalizeFilterValue(v);
    return norm !== undefined;
  });

  if (!hasFilters && !normalizedQuery && !urlHasDateParams) {
    return "all-traces";
  }

  // Check custom views (includes seeded origin views)
  for (const view of customViews) {
    const isSameView =
      filtersMatch(currentFilters, view.filters) &&
      (normalizedQuery ?? undefined) === (view.query ?? undefined) &&
      periodMatches({
        viewPeriod: view.period,
        urlStartDate,
        urlEndDate,
        urlHasDateParams,
      });
    if (isSameView) {
      return view.id;
    }
  }

  return null;
}

/**
 * Generates a unique ID for a new custom view.
 */
export function generateViewId(): string {
  return `view-${nowInstant().epochMilliseconds}-${Math.random().toString(36).slice(2, 9)}`;
}

/** The URL keys a filter reset keeps: the page's own address, not the filters on it. */
const RESET_KEEP = new Set(["project", "view", "group_by", "startDate", "endDate"]);

export function keepOnFilterReset<T>(query: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => RESET_KEEP.has(key)));
}

/** A saved period as URL dates: a relative one ends now, a fixed one is used as saved. */
export function viewPeriodDates(period: SavedView["period"] | undefined): {
  startDate: string | undefined;
  endDate: string | undefined;
} {
  if (period?.relativeDays !== undefined) {
    return {
      endDate: nowInstant().toString({ fractionalSecondDigits: 3 }),
      startDate: subDays(nowInstant().epochMilliseconds, period.relativeDays - 1).toISOString(),
    };
  }
  if (period?.startDate && period.endDate) {
    return { startDate: period.startDate, endDate: period.endDate };
  }
  return { startDate: undefined, endDate: undefined };
}

/** The URL dates as a period to save: relative when they end today or yesterday. */
export function periodFromUrlDates({
  startDate,
  endDate,
}: {
  startDate: string | undefined;
  endDate: string | undefined;
}): SavedView["period"] | undefined {
  if (!startDate || !endDate) return undefined;
  const daysDifference = differenceInCalendarDays(endDate, startDate) + 1;
  const endIsRecent = differenceInCalendarDays(nowInstant().epochMilliseconds, endDate) <= 1;
  return endIsRecent ? { relativeDays: daysDifference } : { startDate, endDate };
}

/** Whether the address itself (not the stored fallback) carries filters, dates or a query. */
export function urlCarriesViewParams(asPath: string): boolean {
  const urlParams = new URLSearchParams(asPath.split("?")[1] ?? "");
  const hasUrlFilters = Object.values(availableFilters).some((f) => urlParams.has(f.urlKey));
  return (
    hasUrlFilters ||
    urlParams.has("startDate") ||
    urlParams.has("endDate") ||
    urlParams.has("query")
  );
}

export function withoutView<T extends { id: string }>(views: readonly T[], viewId: string): T[] {
  return views.filter((v) => v.id !== viewId);
}

export function withViewRenamed<T extends { id: string; name: string }>(
  views: readonly T[],
  viewId: string,
  name: string,
): T[] {
  return views.map((v) => (v.id === viewId ? { ...v, name } : v));
}

/** Views in the given id order, each stamped with its new position; unknown ids drop out. */
export function inViewOrder<T extends { id: string }>(
  views: readonly T[],
  viewIds: readonly string[],
): (T & { order: number })[] {
  const viewMap = new Map(views.map((v) => [v.id, v]));
  return viewIds.flatMap((id, index) => {
    const view = viewMap.get(id);
    return view ? [{ ...view, order: index }] : [];
  });
}
