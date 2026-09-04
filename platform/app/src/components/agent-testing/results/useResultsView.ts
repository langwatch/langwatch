/**
 * What the Results tab is currently showing: how it is grouped, what is
 * filtered out, whether the charts are open, and which rows are expanded.
 *
 * The grouping and the filters live in the address, so the browser back button
 * retraces the steps a person took and a link to "the failures of last week"
 * opens on the failures of last week. The charts toggle and the opened rows do
 * not: they are how someone is looking at the page right now, not what the
 * page is showing.
 *
 * The address is written through `buildAgentTestingPush`, which owns the
 * segments of this page. A plain push of `router.pathname` would leave the
 * catch-all segment unresolved and bounce the address back to the tab root.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "~/utils/compat/next-router";
import {
  type AgentTestingRoutingState,
  buildAgentTestingPush,
} from "../useAgentTestingRouting";
import {
  RESULT_GROUPINGS,
  type ResultFilters,
  type ResultGrouping,
} from "./result-atoms";

/** The grouping the tab opens on. */
export const DEFAULT_RESULT_GROUPING: ResultGrouping = "plan";

/** The address parameters this view owns, and so may clear. */
export const RESULTS_VIEW_PARAMS = [
  "groupBy",
  "scenarios",
  "labels",
  "targets",
  "status",
] as const;

function toGrouping(value: string | undefined): ResultGrouping {
  return value && (RESULT_GROUPINGS as readonly string[]).includes(value)
    ? (value as ResultGrouping)
    : DEFAULT_RESULT_GROUPING;
}

function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

function toStatus(value: string | undefined): ResultFilters["status"] {
  return value === "passed" || value === "failed" ? value : "all";
}

/** The address parameters this view reads and writes. */
export type ResultsViewQuery = {
  groupBy?: string;
  scenarios?: string;
  labels?: string;
  targets?: string;
  status?: string;
};

/**
 * What a query says, as view state.
 *
 * Anything unreadable falls back to the default rather than rendering broken,
 * which is what makes a hand-edited or a stale link degrade instead of failing.
 */
export function readResultsViewQuery(query: ResultsViewQuery): {
  grouping: ResultGrouping;
  filters: ResultFilters;
} {
  return {
    grouping: toGrouping(query.groupBy),
    filters: {
      scenarioIds: toList(query.scenarios),
      labels: toList(query.labels),
      targetKeys: toList(query.targets),
      status: toStatus(query.status),
    },
  };
}

/** View state as a query, with everything at its default left out. */
export function writeResultsViewQuery({
  grouping,
  filters,
}: {
  grouping: ResultGrouping;
  filters: ResultFilters;
}): ResultsViewQuery {
  const query: ResultsViewQuery = {};
  if (grouping !== DEFAULT_RESULT_GROUPING) query.groupBy = grouping;
  if (filters.scenarioIds.length)
    query.scenarios = filters.scenarioIds.join(",");
  if (filters.labels.length) query.labels = filters.labels.join(",");
  if (filters.targetKeys.length) query.targets = filters.targetKeys.join(",");
  if (filters.status !== "all") query.status = filters.status;
  return query;
}

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function useResultsView(state: AgentTestingRoutingState) {
  const router = useRouter();
  const projectSlug = firstOf(router.query.project);

  const { grouping, filters } = useMemo(
    () =>
      readResultsViewQuery({
        groupBy: firstOf(router.query.groupBy),
        scenarios: firstOf(router.query.scenarios),
        labels: firstOf(router.query.labels),
        targets: firstOf(router.query.targets),
        status: firstOf(router.query.status),
      }),
    [router.query],
  );

  const [isChartsShown, setChartsShown] = useState(false);
  const [openedKeys, setOpenedKeys] = useState<string[]>([]);

  const write = useCallback(
    (next: { grouping: ResultGrouping; filters: ResultFilters }) => {
      if (!projectSlug) return;

      // The view params are dropped before the new ones are set, so a filter
      // that goes back to its default leaves the address rather than staying
      // in it at an empty value.
      const query = { ...router.query };
      for (const key of RESULTS_VIEW_PARAMS) delete query[key];

      const { route, address } = buildAgentTestingPush({
        projectSlug,
        state,
        query: { ...query, ...writeResultsViewQuery(next) },
      });
      void router.push(route, address, { shallow: true });
    },
    [router, projectSlug, state],
  );

  const toggleCharts = useCallback(() => setChartsShown((shown) => !shown), []);

  const toggleOpen = useCallback((key: string) => {
    setOpenedKeys((held) =>
      held.includes(key) ? held.filter((open) => open !== key) : [...held, key],
    );
  }, []);

  // A row opened under one grouping means nothing under the next one, and a
  // key left behind would reopen a row nobody opened.
  const changeGrouping = useCallback(
    (next: ResultGrouping) => {
      setOpenedKeys([]);
      write({ grouping: next, filters });
    },
    [write, filters],
  );

  const changeFilters = useCallback(
    (next: ResultFilters) => {
      setOpenedKeys([]);
      write({ grouping, filters: next });
    },
    [write, grouping],
  );

  return {
    grouping,
    onGroupingChange: changeGrouping,
    filters,
    onFiltersChange: changeFilters,
    isChartsShown,
    onChartsToggle: toggleCharts,
    openedKeys,
    onToggleOpen: toggleOpen,
  };
}
