import { useRouter } from "next/router";
import qs from "qs";
import { usePeriodSelector } from "../components/PeriodSelector";
import {
  countActiveFilters,
  filterOutEmptyFilters,
} from "../server/analytics/utils";
import { availableFilters } from "../server/filters/registry";
import type { FilterField } from "../server/filters/types";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

export type FilterParam =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

export const useFilterParams = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const {
    period: { startDate, endDate },
  } = usePeriodSelector();

  const filters: Partial<Record<FilterField, FilterParam>> = {};

  const queryString = router.asPath.split("?")[1] ?? "";
  const queryParams = qs.parse(queryString, {
    allowDots: true,
    comma: true,
    allowEmptyArrays: true,
  });

  for (const [filterKey, filter] of Object.entries(availableFilters)) {
    const param = queryParams[filter.urlKey];
    if (param) {
      const filterParam =
        typeof param === "string" ? [param] : (param as FilterParam);

      const filterEmptyAndConverScalarToArray = (
        obj: FilterParam,
        filter: boolean,
      ): FilterParam => {
        if (Array.isArray(obj)) {
          return obj.filter((x) => x !== "");
        }

        return Object.fromEntries(
          Object.entries(obj).flatMap(
            ([key, value]): [string, FilterParam][] => {
              if (Array.isArray(value)) {
                const value_ = value.filter((x) => x !== "");
                if (filter && value_.length === 0) {
                  return [];
                }
                return [[key, value_]];
              } else if (value && typeof value === "object") {
                const value_ = filterEmptyAndConverScalarToArray(value, filter);
                if (filter && Object.keys(value_).length === 0) {
                  return [];
                }
                return [[key, value_]];
              } else {
                return [[key, [value]]];
              }
            },
          ),
        ) as FilterParam;
      };

      const filterParam_ = filterEmptyAndConverScalarToArray(
        filterParam,
        false,
      );
      filters[filterKey as FilterField] = filterParam_;
    }
  }

  // Saved view fallback: when the URL has no filter/date/query params and a
  // saved view is stored in localStorage, use the view's filters so the first
  // query already has the correct filters. Layout params like project, view,
  // group_by are fine — only filter keys, dates, and search prevent fallback.
  const hasUrlFilterOrDateParams =
    Object.values(availableFilters).some(
      (f) => queryParams[f.urlKey] !== undefined,
    ) ||
    !!queryParams.query ||
    !!queryParams.startDate ||
    !!queryParams.endDate;

  if (!hasUrlFilterOrDateParams && project?.id) {
    try {
      const viewId =
        localStorage.getItem(
          `langwatch-saved-views-selected-${project.id}`,
        ) ??
        localStorage.getItem(`langwatch-selected-view-${project.id}`);

      if (viewId && viewId !== "all-traces") {
        const raw = localStorage.getItem(
          `langwatch-saved-views-cache-${project.id}`,
        );
        if (raw) {
          const cached = JSON.parse(raw) as Array<{
            id: string;
            filters?: Record<string, FilterParam>;
          }>;
          const view = cached.find((v) => v.id === viewId);
          if (view?.filters) {
            for (const [key, value] of Object.entries(view.filters)) {
              if (key in availableFilters) {
                filters[key as FilterField] = value;
              }
            }
          }
        }
      }
    } catch {
      // localStorage unavailable or corrupt — ignore
    }
  }

  // Read the query from window.location.search (always current after
  // history.pushState) instead of router.query/router.asPath (React state,
  // stale between renders) to avoid race conditions when multiple filter
  // changes happen before React re-renders.
  const parseCurrentQuery = () => {
    const search =
      typeof window !== "undefined" ? window.location.search.slice(1) : "";
    return qs.parse(search, {
      allowDots: false,
      comma: true,
      allowEmptyArrays: true,
    });
  };

  const setFilter = (filter: FilterField, params: FilterParam) => {
    const filterUrl = availableFilters[filter].urlKey;
    const currentQuery = parseCurrentQuery();
    void router.push(
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(currentQuery).filter(
                ([key]) =>
                  key !== filterUrl &&
                  !key.startsWith(filterUrl + "."),
              ),
            ),
            [filterUrl]: params,
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const setFilters = (filtersToSet: Record<FilterField, FilterParam>) => {
    const currentQuery = parseCurrentQuery();
    void router.push(
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(currentQuery).filter(
                ([key]) =>
                  !Object.values(availableFilters).some(
                    (f) => key === f.urlKey || key.startsWith(f.urlKey + "."),
                  ),
              ),
            ),
            ...Object.entries(filtersToSet).reduce(
              (acc, [filter, params]) => ({
                ...acc,
                [availableFilters[filter as keyof typeof availableFilters]
                  .urlKey]: params,
              }),
              {},
            ),
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const clearFilters = () => {
    const currentQuery = parseCurrentQuery();
    void router.push(
      "?" +
        qs.stringify(
          Object.fromEntries(
            Object.entries(currentQuery).filter(
              ([key]) =>
                key !== "query" &&
                !Object.values(availableFilters).some(
                  (filter) =>
                    key === filter.urlKey ||
                    key.startsWith(filter.urlKey + "."),
                ),
            ),
          ),
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const filterParams = {
    projectId: project?.id ?? "",
    startDate: startDate.getTime(),
    endDate: endDate.getTime(),
    filters: filters,
    ...(queryParams.query ? { query: queryParams.query as string } : {}),
    ...(queryParams.negateFilters === "true" ? { negateFilters: true } : {}),
  };

  const getLatestFilters = () => {
    return filterParams;
  };

  const setNegateFilters = (negateFilters: boolean) => {
    const currentQuery = parseCurrentQuery();
    void router.push(
      "?" +
        qs.stringify(
          {
            ...currentQuery,
            negateFilters: negateFilters ? "true" : "false",
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          },
        ),
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const nonEmptyFilters = filterOutEmptyFilters(filterParams.filters);
  const filterCount = countActiveFilters(filterParams.filters);
  const hasAnyFilters = filterCount > 0;

  return {
    filters,
    setFilter,
    setFilters,
    clearFilters,
    getLatestFilters,
    filterParams,
    nonEmptyFilters,
    filterCount,
    hasAnyFilters,
    queryOpts: {
      enabled:
        !!project &&
        !!startDate &&
        !isNaN(startDate.getTime()) &&
        !!endDate &&
        !isNaN(endDate.getTime()),
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      trpc: {
        context: {
          skipBatch: true,
        },
      },
    },
    setNegateFilters,
  };
};
