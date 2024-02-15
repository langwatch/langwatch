import { Alert, AlertIcon, Box, Spinner, useTheme } from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import numeral from "numeral";
import React from "react";
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
import type { z } from "zod";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import {
  getGroup,
  type timeseriesInput,
} from "../../server/analytics/registry";
import type { AppRouter } from "../../server/api/root";
import { api } from "../../utils/api";
import { uppercaseFirstLetter } from "../../utils/stringCasing";
import type { Unpacked } from "../../utils/types";
import type { RotatingColorSet } from "../../utils/rotatingColors";

export type CustomGraphInput = {
  graphId: string;
  graphType: "line" | "bar" | "stacked_bar" | "area" | "stacked_area";
  series: (Unpacked<z.infer<typeof timeseriesInput>["series"]> & {
    name: string;
    colorSet: RotatingColorSet;
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
  const currentAndPreviousDataFilled = fillEmptyData(
    currentAndPreviousData,
    expectedKeys
  );
  const keysToSum = Object.fromEntries(
    expectedKeys.map((key) => [
      key,
      currentAndPreviousDataFilled?.reduce(
        (acc, entry) => acc + (entry[key] ?? 0),
        0
      ),
    ])
  );
  const sortedKeys = expectedKeys
    .reverse()
    .filter((key) => keysToSum[key]! > 0)
    .sort((a, b) => {
      if (a.startsWith("positive>") || a.startsWith("negative>")) {
        return 0;
      }
      if (a.startsWith("neutral>")) return 1;
      const totalA = keysToSum[a]!;
      const totalB = keysToSum[b]!;

      return totalB - totalA;
    });

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

  const getSeries = (aggKey: string) => {
    let groupKey: string | undefined;
    let seriesKey = aggKey;

    const parts = aggKey.split(">");
    if (parts.length == 2) {
      groupKey = parts[0];
      seriesKey = parts[1]!;
    }
    const series = seriesByKey[seriesKey];

    return { series, groupKey };
  };

  const nameForSeries = (aggKey: string) => {
    const { series, groupKey } = getSeries(aggKey);

    const group =
      input.groupBy && groupKey ? getGroup(input.groupBy) : undefined;
    const groupName = groupKey
      ? `${group?.label.toLowerCase()} ${groupKey}`
      : "";
    return input.series.length > 1
      ? (series?.name ?? aggKey) + (groupName ? ` (${groupName})` : "")
      : groupName
      ? uppercaseFirstLetter(groupName)
      : series?.name ?? aggKey;
  };

  const colorForSeries = (aggKey: string, index: number): string => {
    const { series } = getSeries(aggKey);

    const colorSet: RotatingColorSet = series?.colorSet ?? "grayTones";
    return getColor(colorSet, index);
  };

  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");
  const valueFormatter = (value: number) =>
    Math.round(value) !== value
      ? numeral(value).format("0.00a")
      : numeral(value).format(valueFormat ?? "0a");

  const [GraphComponent, GraphElement] = input.graphType.includes("area")
    ? [AreaChart, Area]
    : input.graphType.includes("bar")
    ? [BarChart, Bar]
    : [LineChart, Line];

  return (
    <Box
      width="full"
      height="full"
      position="relative"
      paddingX={4}
      paddingY={8}
    >
      {timeseries.isFetching && (
        <Spinner position="absolute" right={4} top={4} />
      )}
      {timeseries.error && (
        <Alert
          status="error"
          position="absolute"
          variant="left-accent"
          width="fit-content"
          right={4}
          top={4}
        >
          <AlertIcon />
          Error loading graph data
        </Alert>
      )}
      <ResponsiveContainer
        key={currentAndPreviousDataFilled ? input.graphId : "loading"}
        height={500}
      >
        <GraphComponent
          data={currentAndPreviousDataFilled}
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
          <Legend
            wrapperStyle={{
              padding: "0 2rem",
              maxHeight: "15%",
              overflow: "auto",
            }}
          />
          {(sortedKeys ?? []).map((aggKey, index) => (
            <React.Fragment key={aggKey}>
              {/* @ts-ignore */}
              <GraphElement
                key={aggKey}
                type="linear"
                dataKey={aggKey}
                stroke={colorForSeries(aggKey, index)}
                stackId={
                  ["stacked_bar", "stacked_area"].includes(input.graphType)
                    ? "same"
                    : undefined
                }
                fill={colorForSeries(aggKey, index)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 8 }}
                name={nameForSeries(aggKey)}
              />
              {input.includePrevious && (
                // @ts-ignore
                <GraphElement
                  key={"previous>" + aggKey}
                  type="linear"
                  dataKey={"previous>" + aggKey}
                  stackId={
                    ["stacked_bar", "stacked_area"].includes(input.graphType)
                      ? "same"
                      : undefined
                  }
                  stroke={colorForSeries(aggKey, index) + "99"}
                  fill={colorForSeries(aggKey, index) + "99"}
                  strokeWidth={2.5}
                  strokeDasharray={"5 5"}
                  dot={false}
                  activeDot={{ r: 8 }}
                  name={"Previous " + nameForSeries(aggKey)}
                />
              )}
            </React.Fragment>
          ))}
        </GraphComponent>
      </ResponsiveContainer>
    </Box>
  );
}

const shapeDataForGraph = (
  input: CustomGraphInput,
  timeseries: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
    TRPCClientErrorLike<AppRouter>
  >
) => {
  const flattenGroupData = (
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
    return data;
  };

  const flattenCurrentPeriod =
    timeseries.data && flattenGroupData(timeseries.data.currentPeriod);
  const flattenPreviousPeriod =
    timeseries.data && flattenGroupData(timeseries.data.previousPeriod);

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

  return currentAndPreviousData as
    | ({ date: string } & Record<string, number>)[]
    | undefined;
};

const fillEmptyData = (
  data: ReturnType<typeof shapeDataForGraph>,
  expectedKeys: string[]
) => {
  if (!data) return data;
  const filledData = data.map((entry) => {
    const filledEntry = { ...entry };
    expectedKeys.forEach((key) => {
      if (filledEntry[key] === null || filledEntry[key] === undefined) {
        filledEntry[key] = 0;
      }
      const previousKey = `previous>${key}`;
      if (
        filledEntry[previousKey] === null ||
        filledEntry[previousKey] === undefined
      ) {
        filledEntry[previousKey] = 0;
      }
    });
    return filledEntry;
  });
  return filledData;
};
