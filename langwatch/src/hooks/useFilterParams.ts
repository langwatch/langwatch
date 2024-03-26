import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { usePeriodSelector } from "../components/PeriodSelector";
import { useRouter } from "next/router";
import { availableFilters } from "../server/filters/registry";
import type { FilterField } from "../server/filters/types";
import qs from "qs";

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
  const filledFilters: Partial<Record<FilterField, FilterParam>> = {};

  const queryString = router.asPath.split("?")[1] ?? "";
  const queryParams = qs.parse(queryString.replaceAll("%2C", ","), {
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
        filter: boolean
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
            }
          )
        ) as FilterParam;
      };

      const filterParamFilled = filterEmptyAndConverScalarToArray(
        filterParam,
        true
      );
      if (Object.keys(filterParamFilled).length > 0) {
        filledFilters[filterKey as FilterField] = filterParamFilled;
      }

      const filterParam_ = filterEmptyAndConverScalarToArray(
        filterParam,
        false
      );
      filters[filterKey as FilterField] = filterParam_;
    }
  }

  const setFilter = (filter: FilterField, params: FilterParam) => {
    const filterUrl = availableFilters[filter].urlKey;
    void router.push(
      "?" +
        qs.stringify(
          {
            ...Object.fromEntries(
              Object.entries(router.query).filter(
                ([key]) => !key.startsWith(filterUrl + ".")
              )
            ),
            [filterUrl]: params,
          },
          {
            allowDots: true,
            arrayFormat: "comma",
            // @ts-ignore of course it exists
            allowEmptyArrays: true,
          }
        ),
      undefined,
      { shallow: true, scroll: false }
    );
  };

  const clearFilters = () => {
    void router.push(
      {
        query: Object.fromEntries(
          Object.entries(router.query).filter(
            ([key]) =>
              !Object.values(availableFilters).some((filter) =>
                key.startsWith(filter.urlKey)
              )
          )
        ),
      },
      undefined,
      { shallow: true, scroll: false }
    );
  };

  return {
    filters,
    setFilter,
    clearFilters,
    filterParams: {
      projectId: project?.id ?? "",
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters: filledFilters,
    },
    queryOpts: {
      enabled: !!project && !!startDate && !!endDate,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      trpc: {
        context: {
          skipBatch: true,
        },
      },
    },
  };
};
