import type { z } from "zod";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import {
  getMetric,
  metricAggregations,
  type FlattenAnalyticsMetricsEnum,
  type timeseriesInput,
  pipelineAggregations,
  analyticsPipelines,
  getGroup,
} from "../../server/analytics/registry";
import { api } from "../../utils/api";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/api/root";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { TRPCClientErrorLike } from "@trpc/client";
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import { useTheme } from "@chakra-ui/react";
import { format } from "date-fns";
import numeral from "numeral";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Unpacked } from "../../utils/types";
import { uppercaseFirstLetterLowerCaseRest } from "../../utils/stringCasing";

export type CustomGraphInput = {
  graphId: string;
  graphType: "line" | "bar" | "area";
  series: (Unpacked<z.infer<typeof timeseriesInput>["series"]> & {
    name: string;
  })[];
  groupBy: z.infer<typeof timeseriesInput>["groupBy"];
  includePrevious: boolean;
};

export function CustomGraph({ input }: { input: CustomGraphInput }) {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { projectId, startDate, endDate } = analyticsParams;
  const valueFormat = "0a";

  const timeseries = api.analytics.getTimeseries.useQuery(
    {
      projectId,
      startDate,
      endDate,
      filters: {},
      ...input,
    },
    queryOpts
  );
  const currentAndPreviousData = shapeDataForGraph(input, timeseries);

  const expectedKeys = Array.from(
    new Set(
      currentAndPreviousData?.flatMap((entry) =>
        Object.keys(entry).filter(
          (key) => key !== "date" && !key.startsWith("previous")
        )
      ) ?? []
    )
  );
  const seriesByKey = Object.fromEntries(
    input.series.map((series) => {
      const key = [
        series.metric,
        series.aggregation,
        series.pipeline?.field,
        series.pipeline?.aggregation,
      ]
        .filter((x) => x)
        .join("/");

      return [key, series];
    })
  );

  const nameForSeries = (aggKey: string) => {
    let groupKey: string | undefined;
    let seriesKey = aggKey;

    const parts = aggKey.split(">");
    if (parts.length == 2) {
      groupKey = parts[0];
      seriesKey = parts[1]!;
    }
    const series = seriesByKey[seriesKey];

    const group =
      input.groupBy && groupKey ? getGroup(input.groupBy) : undefined;
    const groupName = groupKey
      ? `${group?.label.toLowerCase()} ${groupKey}`
      : "";
    return input.series.length > 1
      ? (series?.name ?? aggKey) + (groupName ? ` (${groupName})` : "")
      : groupName
      ? uppercaseFirstLetterLowerCaseRest(groupName)
      : series?.name ?? aggKey;
  };

  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");
  const valueFormatter = (value: number) =>
    Math.round(value) !== value
      ? numeral(value).format("0.00a")
      : numeral(value).format(valueFormat ?? "0a");

  const [GraphComponent, GraphElement] =
    input.graphType === "area"
      ? [AreaChart, Area]
      : input.graphType === "bar"
      ? [BarChart, Bar]
      : [LineChart, Line];

  return (
    <ResponsiveContainer
      key={currentAndPreviousData ? input.graphId : "loading"}
      height={500}
    >
      <GraphComponent
        data={currentAndPreviousData}
        margin={{ left: (valueFormat ?? "0a").length * 4 - 10 }}
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
          tickFormatter={valueFormatter}
        />
        <Tooltip
          formatter={valueFormatter}
          labelFormatter={(_label, payload) => {
            return (
              formatDate(payload[0]?.payload.date) +
              (input.includePrevious && payload[1]?.payload["previous>date"]
                ? " vs " + formatDate(payload[1]?.payload["previous>date"])
                : "")
            );
          }}
        />
        <Legend />
        {(expectedKeys ?? []).map((aggKey, index) => (
          <>
            <GraphElement
              key={aggKey}
              type="linear"
              dataKey={aggKey}
              stroke={getColor(index)}
              fill={getColor(index)}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 8 }}
              name={nameForSeries(aggKey)}
            />
            {input.includePrevious && (
              <GraphElement
                key={"previous>" + aggKey}
                type="linear"
                dataKey={"previous>" + aggKey}
                stroke={getColor(index) + "99"}
                fill={getColor(index) + "99"}
                strokeWidth={2.5}
                strokeDasharray={"5 5"}
                dot={false}
                activeDot={{ r: 8 }}
                name={"Previous " + nameForSeries(aggKey)}
              />
            )}
          </>
        ))}
      </GraphComponent>
    </ResponsiveContainer>
  );
}

const shapeDataForGraph = (
  input: CustomGraphInput,
  timeseries: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
    TRPCClientErrorLike<AppRouter>
  >
) => {
  const flattenGroupDataAndFillNulls = (
    data: NonNullable<(typeof timeseries)["data"]>["currentPeriod"]
  ) => {
    const groupBy = input.groupBy;
    if (groupBy) {
      return data.map((entry) => {
        const buckets = entry[groupBy] as Record<
          string,
          Record<string, number>
        >;
        const aggregations = Object.fromEntries(
          Object.entries(buckets).flatMap(([bucketKey, bucket]) => {
            return Object.entries(bucket).map(([metricKey, metricValue]) => {
              return [`${bucketKey}>${metricKey}`, metricValue ?? 0];
            });
          })
        );

        return {
          date: entry.date,
          ...aggregations,
        };
      });
    }
    return data.map((entry) =>
      Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [key, value ?? 0])
      )
    ) as ({ date: string } & Record<string, number>)[];
  };

  const flattenCurrentPeriod =
    timeseries.data &&
    flattenGroupDataAndFillNulls(timeseries.data.currentPeriod);
  const flattenPreviousPeriod =
    timeseries.data &&
    flattenGroupDataAndFillNulls(timeseries.data.previousPeriod);

  const currentAndPreviousData =
    flattenCurrentPeriod &&
    flattenPreviousPeriod?.map((entry, index) => {
      return {
        ...flattenCurrentPeriod[index],
        ...Object.fromEntries(
          Object.entries(entry).map(([key, value]) => [
            `previous>${key}`,
            value ?? 0,
          ])
        ),
      };
    });

  return currentAndPreviousData;
};
