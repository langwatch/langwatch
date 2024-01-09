import { Box, Skeleton } from "@chakra-ui/react";
import {
  useAnalyticsParams,
  useIsAggregated,
} from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import numeral from "numeral";
import {
  AggregatedLineChart,
  CurrentVsPreviousPeriodLineChart,
} from "./LineChart";

export const LLMCostSumGraph = () => {
  const isAggregated = useIsAggregated();

  return isAggregated ? (
    <LLMCostSumAggregatedGraph />
  ) : (
    <LLMCostSumVsPreviousPeriodGraph />
  );
};

const LLMCostSumVsPreviousPeriodGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.llmCostSumVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  return (
    <CurrentVsPreviousPeriodLineChart
      data={data}
      valueKey="total_cost"
      valueFormat="$0.00a"
    />
  );
};

const LLMCostSumAggregatedGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.llmCostSumAggregated.useQuery(
    analyticsParams,
    queryOpts
  );

  return (
    <AggregatedLineChart
      data={data}
      valueKey="total_cost"
      valueFormat="$0.00a"
    />
  );
};

export const LLMCostSumSummary = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const { data } = api.analytics.llmCostSumVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  if (!data) {
    return (
      <Box paddingY="0.25em">
        <Skeleton height="1em" width="80px" />
      </Box>
    );
  }

  let total = 0;
  for (const entry of data.currentPeriod) {
    total += entry.total_cost;
  }

  return numeral(total).format("$0.00a");
};
