import { Box, Skeleton } from "@chakra-ui/react";
import numeral from "numeral";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { AggregatedLineChart } from "./LineChart";
import { SummaryMetricValue } from "./SummaryMetric";

export const LLMCallsCountGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.llmCallsCountAggregated.useQuery(
    {
      ...analyticsParams,
      aggregations: ["model"],
    },
    queryOpts
  );

  return <AggregatedLineChart data={data} valueKey="count" />;
};

export const LLMCallsCountSummary = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const { data } = api.analytics.llmCallsCountVsPreviousPeriod.useQuery(
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
    current += entry.count;
  }
  for (const entry of data.previousPeriod) {
    previous += entry.count;
  }

  return (
    <SummaryMetricValue
      current={current}
      previous={previous}
      increaseIs="neutral"
    />
  );
};
