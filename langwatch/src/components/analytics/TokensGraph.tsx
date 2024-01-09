import { Box, Skeleton, useTheme } from "@chakra-ui/react";
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
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import { format } from "date-fns";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  Bar,
  Tooltip,
  BarChart,
} from "recharts";

export const TokensSumGraph = () => {
  const isAggregated = useIsAggregated();

  return isAggregated ? (
    <TokensSumAggregatedGraph />
  ) : (
    <TokensSumVsPreviousPeriodGraph />
  );
};

const TokensSumVsPreviousPeriodGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.tokensSumVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  return <TokensChart data={data} />;
};

const TokensSumAggregatedGraph = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.tokensSumAggregated.useQuery(
    analyticsParams,
    queryOpts
  );

  return <TokensChart data={data} />;
};

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

  let total = 0;
  for (const entry of data.currentPeriod) {
    total += entry.prompt_tokens + entry.completion_tokens;
  }

  return numeral(total).format("0a");
};

type TokensGraphData = Record<
  string,
  { date: string; prompt_tokens: number; completion_tokens: number }[]
>;

function TokensChart({ data }: { data: TokensGraphData | undefined }) {
  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];
  const orange400 = theme.colors.orange["400"];
  const blue400 = theme.colors.blue["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  const mergedData: Record<string, number | string>[] = [];
  for (const [key, agg] of Object.entries(data ?? {})) {
    if (!data) continue;

    for (const [index, entry] of agg.entries()) {
      if (!mergedData[index]) mergedData[index] = { date: entry.date };
      mergedData[index]![key] = entry.prompt_tokens + entry.completion_tokens;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data?.currentPeriod ? data.currentPeriod : mergedData}
        margin={{ left: -10 }}
      >
        <CartesianGrid vertical={false} strokeDasharray="5 7" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tick={{ fill: gray400 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickMargin={20}
          domain={[0, "dataMax"]}
          tick={{ fill: gray400 }}
        />
        <Tooltip labelFormatter={formatDate} />
        <Legend />
        {data?.currentPeriod ? (
          <>
            <Bar
              stackId="tokens"
              dataKey="prompt_tokens"
              fill={blue400}
              name="Prompt Tokens"
            />
            <Bar
              stackId="tokens"
              dataKey="completion_tokens"
              fill={orange400}
              name="Completion Tokens"
            />
          </>
        ) : (
          Object.keys(data ?? {}).map((agg, index) => (
            <Bar
              key={agg}
              stackId="tokens"
              dataKey={agg}
              fill={getColor(index)}
              name={agg}
            />
          ))
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
