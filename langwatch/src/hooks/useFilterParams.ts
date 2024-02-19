import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { getSingleQueryParam } from "../utils/getSingleQueryParam";
import { usePeriodSelector } from "../components/PeriodSelector";
import { useRouter } from "next/router";

export const useFilterParams = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const {
    period: { startDate, endDate },
  } = usePeriodSelector();

  const topics = getMultipleQueryParams(router.query.topics);
  // TODO: add type signature same as the shared input schema for endpoints
  return {
    filterParams: {
      projectId: project?.id ?? "",
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters: {
        topics: topics ? { topics } : undefined,
        metadata: {
          user_id: getMultipleQueryParams(router.query.user_id),
          thread_id: getMultipleQueryParams(router.query.thread_id),
          customer_id: getMultipleQueryParams(router.query.customer_ids),
          labels: getMultipleQueryParams(router.query.labels),
        },
      },
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
