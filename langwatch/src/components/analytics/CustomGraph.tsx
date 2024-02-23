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
  getMetric,
  type timeseriesInput,
} from "../../server/analytics/registry";
import type { AppRouter } from "../../server/api/root";
import { api } from "../../utils/api";
import { uppercaseFirstLetter } from "../../utils/stringCasing";
import type { Unpacked } from "../../utils/types";
import type { RotatingColorSet } from "../../utils/rotatingColors";
import type { Payload } from "recharts/types/component/DefaultTooltipContent";

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
    .filter((key) => keysToSum[key]! !== 0)
    .sort((a, b) => {
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
    const { series, groupKey } = getSeries(aggKey);

    const colorSet: RotatingColorSet = series?.colorSet ?? "grayTones";

    if (colorSet === "positiveNegativeNeutral" && groupKey) {
      const [positive, negative, neutral] = [0, 1, 2];
      const colorMap: Record<string, number> = {
        positive,
        negative,
        neutral,
        error: negative,
        failed: negative,
        succeeded: positive,
      };

      return getColor(colorSet, colorMap[groupKey] ?? neutral);
    }

    return getColor(colorSet, index);
  };

  const formatWith = (
    format: string | ((value: number) => string) | undefined,
    value: number
  ) => {
    if (typeof format === "function") {
      return format(value);
    }
    return numeral(value).format(format ?? "0a");
  };

  const valueFormats = Array.from(
    new Set(
      input.series.map((series) => {
        const metric = getMetric(series.metric);
        return metric?.format ?? "0a";
      })
    )
  );
  const yAxisValueFormat = valueFormats.length === 1 ? valueFormats[0] : "";
  const keysToMax = Object.fromEntries(
    expectedKeys.map((key) => [
      key,
      currentAndPreviousDataFilled?.reduce(
        (acc, entry) => Math.max(acc, entry[key] ?? 0),
        0
      ) ?? 0,
    ])
  );
  const maxValue = formatWith(
    yAxisValueFormat,
    Math.max(...Object.values(keysToMax))
  );

  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");
  const tooltipValueFormatter = (
    value: number,
    _: string,
    payload: Payload<any, any>
  ) => {
    const { series } = getSeries(payload.dataKey as string);
    const metric = series?.metric && getMetric(series.metric);

    return formatWith(metric?.format, value);
  };

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
          margin={{ left: maxValue.length * 6 - 12 }}
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
            // tickSize={0}
            domain={[0, "dataMax"]}
            tick={{ fill: gray400 }}
            tickFormatter={(value) => {
              if (typeof yAxisValueFormat === "function") {
                return yAxisValueFormat(value);
              }
              return numeral(value).format(yAxisValueFormat);
            }}
          />
          <Tooltip
            formatter={tooltipValueFormatter}
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
