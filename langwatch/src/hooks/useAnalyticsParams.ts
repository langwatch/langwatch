import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { getSingleQueryParam } from "../utils/getSingleQueryParam";
import { usePeriodSelector } from "../components/PeriodSelector";
import { useRouter, type NextRouter } from "next/router";

export const useAnalyticsParams = () => {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();

  const {
    period: { startDate, endDate },
  } = usePeriodSelector();

  const aggregations = Object.keys(getAggregators(router)) as (keyof ReturnType<
    typeof getAggregators
  >)[];

  return {
    analyticsParams: {
      projectId: project?.id ?? "",
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      user_id: getSingleQueryParam(router.query.user_id),
      thread_id: getSingleQueryParam(router.query.thread_id),
      customer_ids: getCustomerIds(router),
      labels: getLabels(router),
      aggregations: aggregations,
    },
    queryOpts: {
      enabled: !!project && !!startDate && !!endDate,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  };
};

export const useIsAggregated = () => {
  const router = useRouter();
  return Object.values(getAggregators(router)).some((items) => items?.length);
};

const getAggregators = (
  router: NextRouter
): {
  customer_id?: string[];
  labels?: string[];
} => {
  const aggregators = {
    customer_id: getCustomerIds(router),
    labels: getLabels(router),
  };
  for (const [key, items] of Object.entries(aggregators)) {
    if ((items ?? []).length < 2) {
      delete aggregators[key as keyof typeof aggregators];
    }
  }
  return aggregators;
};

const getCustomerIds = (router: NextRouter) =>
  getSingleQueryParam(router.query.customer_ids)?.split(",");

const getLabels = (router: NextRouter) =>
  getSingleQueryParam(router.query.labels)?.split(",");
