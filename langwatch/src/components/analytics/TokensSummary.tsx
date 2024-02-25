import { Box, Skeleton } from "@chakra-ui/react";
import {
  useAnalyticsParams
} from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { SummaryMetricValue } from "./SummaryMetric";

export const TokensSumSummary = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const { data } = api.analytics.tokensSumVsPreviousPeriod.useQuery(
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
    current += entry.prompt_tokens + entry.completion_tokens;
  }
  for (const entry of data.previousPeriod) {
    previous += entry.prompt_tokens + entry.completion_tokens;
  }

  return <SummaryMetricValue current={current} previous={previous} increaseIs="neutral" />;
};
