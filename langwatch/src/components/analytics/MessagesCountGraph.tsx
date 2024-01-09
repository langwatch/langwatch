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

export const MessagesCountGraph = () => {
  const isAggregated = useIsAggregated();

  return isAggregated ? (
    <MessagesCountAggregatedGraph />
  ) : (
    <MessagesCountVsPreviousPeriodGraph />
  );
};

const MessagesCountVsPreviousPeriodGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.messagesCountVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  return <CurrentVsPreviousPeriodLineChart data={data} valueKey="messages_count" />;
};

const MessagesCountAggregatedGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.messagesCountAggregated.useQuery(
    analyticsParams,
    queryOpts
  );

  return <AggregatedLineChart data={data} valueKey="messages_count" />;
};

export const MessagesCountSummary = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const { data } = api.analytics.messagesCountVsPreviousPeriod.useQuery(
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
    total += entry.messages_count;
  }

  return numeral(total).format("0a");
};
