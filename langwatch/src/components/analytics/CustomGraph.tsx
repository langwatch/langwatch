import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Spinner,
  useTheme,
  type ColorProps,
  type TypographyProps,
  Flex,
} from "@chakra-ui/react";
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
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultTooltipContent";
import type { z } from "zod";
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import {
  getGroup,
  getMetric,
  type timeseriesSeriesInput,
} from "../../server/analytics/registry";
import type { AppRouter } from "../../server/api/root";
import { api } from "../../utils/api";
import type { RotatingColorSet } from "../../utils/rotatingColors";
import { uppercaseFirstLetter } from "../../utils/stringCasing";
import type { Unpacked } from "../../utils/types";
import { SummaryMetric } from "./SummaryMetric";
import { useFilterParams } from "../../hooks/useFilterParams";
import { QuickwitNote } from "./QuickwitNote";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { Delayed } from "../Delayed";

type Series = Unpacked<z.infer<typeof timeseriesSeriesInput>["series"]> & {
  name: string;
  colorSet: RotatingColorSet;
};

export type CustomGraphInput = {
  startDate?: number;
  endDate?: number;
  graphId: string;
  filters?: any;
  graphType:
    | "line"
    | "bar"
    | "horizontal_bar"
    | "stacked_bar"
    | "area"
    | "stacked_area"
    | "scatter"
    | "pie"
    | "donnut"
    | "summary";
  series: Series[];
  groupBy?: z.infer<typeof timeseriesSeriesInput>["groupBy"];
  includePrevious: boolean;
  timeScale: "full" | number;
  connected?: boolean;
  height?: number;
};

export const summaryGraphTypes: CustomGraphInput["graphType"][] = [
  "summary",
  "pie",
  "donnut",
];

const GraphComponentMap: Partial<{
  [K in CustomGraphInput["graphType"]]: [
    typeof LineChart | typeof BarChart | typeof AreaChart | typeof PieChart,
    typeof Line | typeof Bar | typeof Area | typeof Scatter,
  ];
}> = {
  line: [LineChart, Line],
  bar: [BarChart, Bar],
  stacked_bar: [BarChart, Bar],
  horizontal_bar: [BarChart, Bar],
  area: [AreaChart, Area],
  stacked_area: [AreaChart, Area],
  scatter: [ScatterChart, Scatter],
};

export function CustomGraph({
  input,
  titleProps,
  hideGroupLabel = false,
}: {
  input: CustomGraphInput;
  titleProps?: {
    fontSize?: TypographyProps["fontSize"];
    color?: ColorProps["color"];
    fontWeight?: TypographyProps["fontWeight"];
  };
  hideGroupLabel?: boolean;
}) {
  const publicEnv = usePublicEnv();

  if (
    publicEnv.data?.IS_QUICKWIT &&
    (input.series.some(
      (series) => !getMetric(series.metric).quickwitSupport || series.pipeline
    ) ||
      (input.groupBy && !getGroup(input.groupBy).quickwitSupport))
  ) {
    return <QuickwitNote />;
  }

  return (
    <CustomGraph_
      input={input}
      titleProps={titleProps}
      hideGroupLabel={hideGroupLabel}
      enabled={!!publicEnv.data}
    />
  );
}

const CustomGraph_ = React.memo(
  function CustomGraph({
    input,
    titleProps,
    hideGroupLabel = false,
    enabled = true,
  }: {
    input: CustomGraphInput;
    titleProps?: {
      fontSize?: TypographyProps["fontSize"];
      color?: ColorProps["color"];
      fontWeight?: TypographyProps["fontWeight"];
    };
    hideGroupLabel?: boolean;
    enabled?: boolean;
  }) {
    const height_ = input.height ?? 300;
    const { filterParams, queryOpts } = useFilterParams();

    const timeseries = api.analytics.getTimeseries.useQuery(
      {
        ...filterParams,
        ...input,
        timeScale: summaryGraphTypes.includes(input.graphType)
          ? "full"
          : input.timeScale === "full"
          ? input.timeScale
          : parseInt(input.timeScale.toString(), 10),
      },
      { ...queryOpts, enabled: queryOpts.enabled && enabled }
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
    const currentAndPreviousDataFilled =
      input.graphType === "scatter"
        ? currentAndPreviousData
        : fillEmptyData(currentAndPreviousData, expectedKeys);
    const keysToValues = Object.fromEntries(
      expectedKeys.map((key) => [
        key,
        currentAndPreviousDataFilled?.reduce(
          (acc, entry) => [...acc, entry[key]!],
          [] as number[]
        ) ?? [],
      ])
    );
    const keysToSum = Object.fromEntries(
      Object.entries(keysToValues).map(([key, values]) => [
        key,
        values.reduce((acc, value) => acc + value, 0),
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

    const nameForSeries = (aggKey: string) => {
      const { series, groupKey } = getSeries(seriesByKey, aggKey);

      const group =
        input.groupBy && groupKey ? getGroup(input.groupBy) : undefined;
      const groupName = groupKey
        ? `${hideGroupLabel ? "" : group?.label.toLowerCase() + " "}${groupKey}`
        : "";
      return input.series.length > 1
        ? (series?.name ?? aggKey) + (groupName ? ` (${groupName})` : "")
        : groupName
        ? uppercaseFirstLetter(groupName)
            .replace("Evaluation passed passed", "Evaluation Passed")
            .replace("Evaluation passed failed", "Evaluation Failed")
            .replace("Contains error", "Messages")
        : series?.name ?? aggKey;
    };

    const colorForSeries = (aggKey: string, index: number): string => {
      const { series, groupKey } = getSeries(seriesByKey, aggKey);

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
          skipped: neutral,
          processed: positive,
          passed: positive,
          "with error": negative,
          "without error": positive,
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
    const maxValue = Math.max(
      ...Object.values(keysToValues).flatMap((values) => values)
    );

    const getColor = useGetRotatingColorForCharts();
    const theme = useTheme();
    const gray400 = theme.colors.gray["400"];

    const formatDate = (date: string) =>
      date && format(new Date(date), "MMM d");
    const tooltipValueFormatter = (
      value: number | string,
      _: string,
      payload: Payload<any, any>
    ) => {
      if (payload.dataKey === "date") {
        return formatDate(value as string);
      }
      const { series } = getSeries(
        seriesByKey,
        payload.payload?.key ?? (payload.dataKey as string)
      );
      const metric = series?.metric && getMetric(series.metric);

      return formatWith(metric?.format, value as number);
    };

    const container = (child: React.ReactNode) => {
      const allEmpty =
        currentAndPreviousData &&
        (maxValue == 0 || currentAndPreviousData?.length === 0);

      return (
        <Box width="full" height="full" position="relative">
          {input.graphType !== "summary" && timeseries.isFetching && (
            <Delayed>
              <Spinner position="absolute" right={4} top={4} />
            </Delayed>
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
          {input.graphType !== "summary" && allEmpty && (
            <Box
              position="absolute"
              top="50%"
              left="50%"
              transform="translate(-50%, -50%)"
            >
              No data
            </Box>
          )}
          {child}
        </Box>
      );
    };

    if (input.graphType === "summary") {
      const summaryData = shapeDataForSummary(
        input,
        seriesByKey,
        timeseries,
        nameForSeries
      );

      const seriesSet = Object.fromEntries(
        input.series
          .reverse()
          .map((series) => [
            series.metric +
              series.aggregation +
              series.pipeline?.field +
              series.pipeline?.aggregation,
            series,
          ])
      );

      return container(
        <HStack spacing={0} align="start" minHeight="101px" overflowX={"auto"}>
          <Flex paddingBottom={3}>
            {timeseries.isLoading &&
              Object.entries(seriesSet).map(([key, series]) => (
                <SummaryMetric
                  key={key}
                  label={series.name}
                  titleProps={titleProps}
                />
              ))}
            {summaryData.current.slice(0, 10).map((entry, index) => (
              <SummaryMetric
                key={entry.key}
                label={entry.name}
                current={entry.value}
                previous={summaryData.previous[index]?.value}
                format={entry.metric?.format}
                increaseIs={entry.metric?.increaseIs}
                titleProps={titleProps}
              />
            ))}
          </Flex>
        </HStack>
      );
    }

    if (input.graphType === "pie" || input.graphType === "donnut") {
      const summaryData = shapeDataForSummary(
        input,
        seriesByKey,
        timeseries,
        nameForSeries
      );

      return container(
        <ResponsiveContainer
          key={currentAndPreviousDataFilled ? input.graphId : "loading"}
          height={height_}
        >
          <PieChart>
            <Pie
              data={summaryData.current}
              nameKey="name"
              dataKey="value"
              labelLine={false}
              label={pieChartPercentageLabel}
              innerRadius={input.graphType === "donnut" ? "50%" : 0}
            >
              {summaryData.current.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colorForSeries(entry.key, index)}
                />
              ))}
            </Pie>
            <Tooltip formatter={tooltipValueFormatter} />
            <Legend
              wrapperStyle={{
                padding: "0 2rem",
                maxHeight: "15%",
                overflow: "auto",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    const [GraphComponent, GraphElement] = GraphComponentMap[input.graphType]!;

    const [XAxisComponent, YAxisComponent] =
      input.graphType === "horizontal_bar" ? [YAxis, XAxis] : [XAxis, YAxis];

    if (
      ["bar", "horizontal_bar"].includes(input.graphType) &&
      input.timeScale === "full"
    ) {
      const summaryData = shapeDataForSummary(
        input,
        seriesByKey,
        timeseries,
        nameForSeries
      );
      const sortedCurrentData = summaryData.current.sort(
        (a, b) => b.value - a.value
      );

      const longestName = Math.max(
        ...summaryData.current.map((entry) => entry.name.length)
      );

      const xAxisWidth = Math.min(longestName * 8, 300);

      return container(
        <ResponsiveContainer
          key={currentAndPreviousDataFilled ? input.graphId : "loading"}
          height={height_}
        >
          <BarChart
            data={sortedCurrentData}
            barCategoryGap={10}
            layout={
              input.graphType === "horizontal_bar" ? "vertical" : undefined
            }
          >
            <XAxisComponent
              type="category"
              dataKey="name"
              width={
                input.graphType === "horizontal_bar" ? xAxisWidth : undefined
              }
              height={
                input.graphType === "horizontal_bar" ? undefined : xAxisWidth
              }
              tickLine={false}
              axisLine={false}
              tick={{ fill: gray400 }}
              angle={input.graphType === "horizontal_bar" ? undefined : 45}
              textAnchor={
                input.graphType === "horizontal_bar" ? "end" : "start"
              }
            />
            <YAxisComponent
              type="number"
              dataKey="value"
              domain={[0, "dataMax"]}
              tick={{ fill: gray400 }}
              tickFormatter={(value) => {
                if (typeof yAxisValueFormat === "function") {
                  return yAxisValueFormat(value);
                }
                return numeral(value).format(yAxisValueFormat);
              }}
            />
            <Tooltip formatter={tooltipValueFormatter} />
            <Bar dataKey="value">
              {summaryData.current.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colorForSeries(entry.key, index)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return container(
      <ResponsiveContainer
        key={currentAndPreviousDataFilled ? input.graphId : "loading"}
        height={height_}
      >
        <GraphComponent
          data={currentAndPreviousDataFilled}
          margin={{
            top: 10,
            left: formatWith(yAxisValueFormat, maxValue).length * 6 - 5,
            right: 24,
          }}
          layout={input.graphType === "horizontal_bar" ? "vertical" : undefined}
        >
          <CartesianGrid
            vertical={input.graphType === "scatter"}
            strokeDasharray="5 7"
          />
          <XAxisComponent
            type="category"
            dataKey="date"
            name="Date"
            tickFormatter={formatDate}
            tickLine={false}
            axisLine={false}
            tick={{ fill: gray400 }}
          />
          <YAxisComponent
            type="number"
            axisLine={false}
            tickLine={false}
            tickCount={4}
            tickMargin={20}
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
              if (input.graphType === "scatter") return "";
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
                activeDot={input.graphType !== "scatter" ? { r: 8 } : undefined}
                name={nameForSeries(aggKey)}
                line={
                  input.graphType === "scatter" && input.connected
                    ? true
                    : undefined
                }
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
                  strokeDasharray={
                    input.graphType !== "scatter" ? "5 5" : undefined
                  }
                  dot={false}
                  activeDot={
                    input.graphType !== "scatter" ? { r: 8 } : undefined
                  }
                  name={"Previous " + nameForSeries(aggKey)}
                  line={
                    input.graphType === "scatter" && input.connected
                      ? true
                      : undefined
                  }
                />
              )}
            </React.Fragment>
          ))}
        </GraphComponent>
      </ResponsiveContainer>
    );
  },
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.input) === JSON.stringify(nextProps.input) &&
      JSON.stringify(prevProps.titleProps) ===
        JSON.stringify(nextProps.titleProps)
    );
  }
);

const RADIAN = Math.PI / 180;
const pieChartPercentageLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}) => {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const getSeries = (seriesByKey: Record<string, Series>, aggKey: string) => {
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

const shapeDataForGraph = (
  input: CustomGraphInput,
  timeseries: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
    TRPCClientErrorLike<AppRouter>
  >
) => {
  const flattenCurrentPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.currentPeriod);
  const flattenPreviousPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.previousPeriod);

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

const shapeDataForSummary = (
  input: CustomGraphInput,
  seriesByKey: Record<string, Series>,
  timeseries: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
    TRPCClientErrorLike<AppRouter>
  >,
  nameForSeries: (aggKey: string) => string
) => {
  const flattenCurrentPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.currentPeriod);
  const flattenPreviousPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.previousPeriod);

  const collectedCurrent = collectAllDays(flattenCurrentPeriod ?? []);
  const collectedPrevious = collectAllDays(flattenPreviousPeriod ?? []);

  const reduceToSummary = (data: Record<string, number[]>) => {
    return Object.entries(data).map(([aggKey, values]) => {
      const { series } = getSeries(seriesByKey, aggKey);
      const metric = series?.metric && getMetric(series.metric);

      return {
        key: aggKey,
        name: nameForSeries(aggKey),
        metric,
        value: values[0] ?? 0,
      };
    });
  };

  return {
    current: reduceToSummary(collectedCurrent),
    previous: reduceToSummary(collectedPrevious),
  };
};

const collectAllDays = (
  data: ({ date: string } & Record<string, number>)[]
) => {
  const result: Record<string, number[]> = {};

  for (const entry of data) {
    for (const key in entry) {
      if (key === "date") continue;
      if (!result[key]) {
        result[key] = [];
      }
      result[key]!.push(entry[key]!);
    }
  }

  return result;
};

const flattenGroupData = (
  input: CustomGraphInput,
  data: NonNullable<
    UseTRPCQueryResult<
      inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
      TRPCClientErrorLike<AppRouter>
    >["data"]
  >["currentPeriod"]
): ({
  date: string;
} & Record<string, number>)[] => {
  const groupBy = input.groupBy;
  if (groupBy) {
    return data.map((entry) => {
      const buckets = entry[groupBy] as unknown as Record<
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
    }) as any;
  }
  return data as any;
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
