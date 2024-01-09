import { Box, Skeleton } from "@chakra-ui/react";
import numeral from "numeral";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { AggregatedLineChart } from "./LineChart";

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

  const { data } = api.analytics.llmCallsCountAggregated.useQuery(
    {
      ...analyticsParams,
      aggregations: ["model"],
    },
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
  for (const bucket of Object.values(data)) {
    for (const entry of bucket) {
      total += entry.count;
    }
  }

  return numeral(total).format("0a");
};
