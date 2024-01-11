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
import { SummaryMetricValue } from "./SummaryMetric";

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

  let current = 0;
  let previous = 0;
  for (const entry of data.currentPeriod) {
    current += entry.total_cost;
  }
  for (const entry of data.previousPeriod) {
    previous += entry.total_cost;
  }

  return (
    <SummaryMetricValue
      current={current}
      previous={previous}
      format="$0.00a"
      increaseIs="bad"
    />
  );
};
