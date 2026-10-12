import { nowInstant } from "@langwatch/time";
import { useMemo, useState } from "react";

import {
  filterExperiments,
  groupByKind,
  isNarrowed,
  NO_FILTERS,
  pageOf,
  type ExperimentGroup,
  type ListFilters,
  type ListGrouping,
} from "../../model/experiments/experiment-list-filter.ts";
import type { ExperimentListRow } from "../../model/experiments/experiment-list-row.ts";

/** While a search or filter is active every experiment is loaded once and narrowed here. */
export const EVERY_EXPERIMENT = 10_000;

/**
 * What the person narrowed the list to, how it is grouped and which groups are folded away. The
 * page size is the list's own (`pageSize`), so narrowing keeps the size the person chose.
 */
export function useExperimentListControls({
  pageSize,
  onPageSizeChange,
}: {
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  const [grouping, setGrouping] = useState<ListGrouping>("none");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  return {
    filters,
    narrowed: isNarrowed(filters),
    changeFilters: (next: ListFilters) => {
      setFilters(next);
      setPage(1);
    },
    grouping,
    setGrouping,
    collapsed,
    toggleGroup: (key: string) =>
      setCollapsed((keys) =>
        keys.includes(key) ? keys.filter((entry) => entry !== key) : [...keys, key],
      ),
    paging: { page, pageSize },
    goToPage: setPage,
    changePageSize: (size: number) => {
      setPage(1);
      onPageSizeChange(size);
    },
  };
}

export type ExperimentListControls = ReturnType<typeof useExperimentListControls>;

/**
 * The rows to draw: every match of an active search, paged here; else the server's page. The page
 * is held inside the last one, so deleting the last row of a page does not leave a blank table.
 */
export function useVisibleExperiments({
  rows,
  controls,
}: {
  rows: ExperimentListRow[] | undefined;
  controls: ExperimentListControls;
}): {
  matching: ExperimentListRow[];
  shown: ExperimentListRow[];
  groups: ExperimentGroup[];
  page: number;
} {
  const { filters, narrowed, grouping, paging } = controls;
  const matching = useMemo(() => {
    if (!narrowed) return rows ?? [];
    return filterExperiments({ rows: rows ?? [], filters, nowMs: nowInstant().epochMilliseconds });
  }, [rows, filters, narrowed]);
  const lastPage = Math.max(1, Math.ceil(matching.length / paging.pageSize));
  const page = Math.min(paging.page, lastPage);
  const shown = narrowed ? pageOf({ rows: matching, page, pageSize: paging.pageSize }) : matching;
  const groups = grouping === "kind" ? groupByKind(shown) : [{ key: "", rows: shown }];
  return { matching, shown, groups, page };
}
