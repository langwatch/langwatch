import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { getSingleQueryParam } from "../utils/getSingleQueryParam";
import { usePeriodSelector } from "../components/PeriodSelector";
import { useRouter } from "next/router";
import { availableFilters } from "../server/filters/registry";
import type { FilterField } from "../server/filters/types";

export const useFilterParams = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const {
    period: { startDate, endDate },
  } = usePeriodSelector();

  const filters: Partial<Record<FilterField, string[]>> = {};

  for (const [key, filter] of Object.entries(availableFilters)) {
    const values = getMultipleQueryParams(router.query[filter.urlKey]);
    if (values) {
      filters[key as FilterField] = values;
    }
  }

  return {
    filterParams: {
      projectId: project?.id ?? "",
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters,
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

const getMultipleQueryParams = (param: string | string[] | undefined) =>
  getSingleQueryParam(param)?.split(",");
