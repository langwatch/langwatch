/**
 * The Agents page's three choices — source, ownership, sort — and where they
 * live.
 *
 * They live in the address. A filtered agents page is a thing an admin sends
 * to the person who owns the agent ("these six are unclaimed"), and a link that
 * arrives showing everything is a link that lost its point. Every choice is
 * therefore a query parameter, read on load, and the default of each one stays
 * out of the address so a bare page keeps a bare URL.
 *
 * Sorting and filtering are pure functions over rows rather than something the
 * card list does for itself, so the page test can state the expected order
 * without rendering anything.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

import {
  AGENT_SOURCE_LABELS,
  AGENT_SOURCES,
  type AgentSource,
  type GovernanceAgentRow,
} from "./agentRows";

/** The source chip's "no filter" value, and the value left out of the URL. */
export const ALL_SOURCES = "all";
export type SourceFilter = typeof ALL_SOURCES | AgentSource;

export const OWNERSHIP_FILTERS = ["all", "unclaimed"] as const;
export type OwnershipFilter = (typeof OWNERSHIP_FILTERS)[number];

export const AGENT_SORTS = ["spend", "requests", "lastActive"] as const;
export type AgentSort = (typeof AGENT_SORTS)[number];

export const OWNERSHIP_LABELS: Record<OwnershipFilter, string> = {
  all: "All agents",
  unclaimed: "Unclaimed only",
};

export const AGENT_SORT_LABELS: Record<AgentSort, string> = {
  spend: "Spend",
  requests: "Requests",
  lastActive: "Last active",
};

export const DEFAULT_AGENT_FILTERS: AgentFilters = {
  source: ALL_SOURCES,
  ownership: "all",
  sort: "spend",
};

export interface AgentFilters {
  source: SourceFilter;
  ownership: OwnershipFilter;
  sort: AgentSort;
}

/**
 * A stale or hand-typed value degrades to the default rather than filtering
 * every row away under a chip that names something the page cannot offer.
 */
export function coerceSource(value: string | null): SourceFilter {
  if (AGENT_SOURCES.some((source) => source === value))
    return value as AgentSource;
  return ALL_SOURCES;
}

export function coerceOwnership(value: string | null): OwnershipFilter {
  return OWNERSHIP_FILTERS.find((option) => option === value) ?? "all";
}

export function coerceSort(value: string | null): AgentSort {
  return AGENT_SORTS.find((option) => option === value) ?? "spend";
}

/** The label the source chip shows for the current choice. */
export function sourceLabel(source: SourceFilter): string {
  return source === ALL_SOURCES ? "All sources" : AGENT_SOURCE_LABELS[source];
}

/**
 * The sources actually present in the rows, in the fixed order the chip lists
 * them. With real rows this is what stops the chip offering a source the
 * organization does not use; with sample rows it is the full list, because the
 * sample set carries one of each.
 */
export function sourcesPresentIn(
  rows: readonly GovernanceAgentRow[],
): AgentSource[] {
  return AGENT_SOURCES.filter((source) =>
    rows.some((row) => row.source === source),
  );
}

/**
 * A missing figure sorts last on every ordering, whichever way that ordering
 * runs. An agent that has never run is not the cheapest agent, and putting it
 * at the top of a spend list would read as though it were.
 *
 * `null` here means "both figures are present, so the ordering decides".
 */
function nullsLast(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return null;
}

/** Biggest first — what both money columns want. */
function descending(a: number | null, b: number | null): number {
  return nullsLast(a, b) ?? (b ?? 0) - (a ?? 0);
}

/** Smallest first — fewer minutes ago is more recently active. */
function ascending(a: number | null, b: number | null): number {
  return nullsLast(a, b) ?? (a ?? 0) - (b ?? 0);
}

function compareAgents(
  sort: AgentSort,
  a: GovernanceAgentRow,
  b: GovernanceAgentRow,
): number {
  if (sort === "lastActive")
    return ascending(a.lastActiveMinutesAgo, b.lastActiveMinutesAgo);
  if (sort === "requests") return descending(a.requests30d, b.requests30d);
  return descending(a.costUsd30d, b.costUsd30d);
}

function matchesFilters(
  row: GovernanceAgentRow,
  { source, ownership }: AgentFilters,
): boolean {
  if (source !== ALL_SOURCES && row.source !== source) return false;
  if (ownership === "unclaimed" && row.owner !== null) return false;
  return true;
}

export function applyAgentFilters(
  rows: readonly GovernanceAgentRow[],
  filters: AgentFilters,
): GovernanceAgentRow[] {
  return rows
    .filter((row) => matchesFilters(row, filters))
    .sort((a, b) => compareAgents(filters.sort, a, b));
}

/**
 * The three choices, read from the address and written back to it.
 *
 * `replace` rather than a history entry: changing a filter is refining one
 * view, not navigating, and stacking six entries would make the back button
 * walk the reader back through their own chip clicks.
 */
export function useAgentFilters(): {
  filters: AgentFilters;
  setFilter: <K extends keyof AgentFilters>(
    key: K,
    value: AgentFilters[K],
  ) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters: AgentFilters = {
    source: coerceSource(searchParams.get("source")),
    ownership: coerceOwnership(searchParams.get("ownership")),
    sort: coerceSort(searchParams.get("sort")),
  };

  const setFilter = useCallback(
    <K extends keyof AgentFilters>(key: K, value: AgentFilters[K]) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (value === DEFAULT_AGENT_FILTERS[key]) next.delete(key);
          else next.set(key, String(value));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilter };
}
