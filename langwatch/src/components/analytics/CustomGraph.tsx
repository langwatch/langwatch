import {
  Alert,
  Box,
  HStack,
  Spinner,
  Flex,
  type SystemStyleObject,
  Text,
  VStack,
  Skeleton,
  Badge,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import numeral from "numeral";
import React, { useMemo } from "react";
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
import { useColorRawValue } from "../../components/ui/color-mode";
import { LuShield } from "react-icons/lu";
import { usePeriodSelector } from "../PeriodSelector";

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
    | "summary"
    | "monitor_graph";
  series: Series[];
  groupBy?: z.infer<typeof timeseriesSeriesInput>["groupBy"];
  includePrevious: boolean;
  timeScale: "full" | number;
  connected?: boolean;
  height?: number;
  monitorGraph?: {
    disabled?: boolean;
    isGuardrail?: boolean;
  };
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
  monitor_graph: [AreaChart, Area],
};

export function CustomGraph({
  input,
  titleProps,
  hideGroupLabel = false,
  size = "md",
}: {
  input: CustomGraphInput;
  titleProps?: SystemStyleObject;
  hideGroupLabel?: boolean;
  size?: "sm" | "md";
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
      load={!!publicEnv.data}
    />
  );
}

const CustomGraph_ = React.memo(
  function CustomGraph({
    input,
    titleProps,
    hideGroupLabel = false,
    load = true,
    size,
  }: {
    input: CustomGraphInput;
    titleProps?: {
      fontSize?: SystemStyleObject["fontSize"];
      color?: SystemStyleObject["color"];
      fontWeight?: SystemStyleObject["fontWeight"];
    };
    hideGroupLabel?: boolean;
    load?: boolean;
    size?: "sm" | "md";
  }) {
    const height_ = input.height ?? 300;
    const { filterParams, queryOpts } = useFilterParams();
    const { daysDifference } = usePeriodSelector();

    const timeScale = useMemo(() => {
      const timeScale_ = summaryGraphTypes.includes(input.graphType)
        ? "full"
        : input.timeScale === "full"
        ? input.timeScale
        : parseInt(input.timeScale.toString(), 10);

      // Show 1 hour granularity for full period when days difference is 2 days or less
      if (
        typeof timeScale_ === "number" &&
        timeScale_ >= 1440 &&
        daysDifference <= 2
      ) {
        return 60;
      }

      return timeScale_;
    }, [input.graphType, input.timeScale, daysDifference]);

    const timeseries = api.analytics.getTimeseries.useQuery(
      {
        ...filterParams,
        ...input,
        timeScale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { ...queryOpts, enabled: queryOpts.enabled && load }
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
        : fillEmptyData(
            currentAndPreviousData,
            expectedKeys,
            input.graphType === "monitor_graph" &&
              input.series[0]?.metric.includes("pass_rate")
              ? 1
              : 0
          );
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
          series.key,
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
            .replace("Contains error", "Traces")
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

        const color = getColor(colorSet, colorMap[groupKey] ?? neutral);
        return color;
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
    const gray400 = useColorRawValue("gray.400");

    const formatDate = (date: string) => {
      if (!date) return "";

      // If timeScale is in minutes (10, 30, or 60), show hours
      if (typeof timeScale === "number" && timeScale < 1440) {
        // If more than one day difference, include the date
        if (daysDifference > 1) {
          return format(new Date(date), "MMM d HH:mm");
        }
        return format(new Date(date), "HH:mm");
      }

      return format(new Date(date), "MMM d");
    };
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
            <Alert.Root
              status="error"
              position="absolute"
              borderStartWidth="4px"
              borderStartColor="colorPalette.solid"
              width="fit-content"
              right={4}
              top={4}
            >
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>Error loading graph data</Alert.Description>
              </Alert.Content>
            </Alert.Root>
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
        <HStack gap={0} align="start" minHeight="101px" overflowX={"auto"}>
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

    if (input.graphType === "monitor_graph") {
      return container(
        <MonitorGraph
          input={input}
          seriesByKey={seriesByKey}
          currentAndPreviousData={currentAndPreviousData}
          currentAndPreviousDataFilled={currentAndPreviousDataFilled}
          sortedKeys={sortedKeys}
          nameForSeries={nameForSeries}
          getColor={getColor}
          size={size}
          filterParams={filterParams}
          height_={height_}
          formatWith={formatWith}
          yAxisValueFormat={yAxisValueFormat}
          formatDate={formatDate}
        />
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
    flattenPreviousPeriod &&
    flattenCurrentPeriod?.map((entry, index) => {
      return {
        ...entry,
        ...Object.fromEntries(
          Object.entries(flattenPreviousPeriod[index] ?? {}).map(
            ([key, value]) => [`previous>${key}`, value ?? 0]
          )
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
  expectedKeys: string[],
  fillWith = 0
) => {
  if (!data) return data;
  const filledData = data.map((entry) => {
    const filledEntry = { ...entry };
    expectedKeys.forEach((key) => {
      if (filledEntry[key] === null || filledEntry[key] === undefined) {
        filledEntry[key] = fillWith;
      }
      const previousKey = `previous>${key}`;
      if (
        filledEntry[previousKey] === null ||
        filledEntry[previousKey] === undefined
      ) {
        filledEntry[previousKey] = fillWith;
      }
    });
    return filledEntry;
  });
  return filledData;
};

function MonitorGraph({
  input,
  seriesByKey,
  sortedKeys,
  currentAndPreviousData,
  currentAndPreviousDataFilled,
  nameForSeries,
  getColor,
  size,
  filterParams,
  height_,
  formatWith,
  yAxisValueFormat,
  formatDate,
}: {
  input: CustomGraphInput;
  seriesByKey: Record<string, Series>;
  currentAndPreviousData: ReturnType<typeof shapeDataForGraph>;
  currentAndPreviousDataFilled: ReturnType<typeof shapeDataForGraph>;
  sortedKeys: string[];
  nameForSeries: (aggKey: string) => string;
  getColor: (
    colorSet: RotatingColorSet,
    index: number,
    opacity: number
  ) => string;
  size?: "sm" | "md";
  filterParams: ReturnType<typeof useFilterParams>["filterParams"];
  height_: number;
  formatWith: (
    format: string | ((value: number) => string) | undefined,
    value: number
  ) => string | ((value: number) => string);
  yAxisValueFormat: string | ((value: number) => string) | undefined;
  formatDate: (date: string) => string;
}) {
  const firstKey = Object.keys(seriesByKey)[0] ?? "";
  const name = nameForSeries(firstKey);
  const isPassRate = firstKey.includes("pass_rate");
  const allValues = isPassRate
    ? currentAndPreviousDataFilled
        ?.map((entry) => entry[firstKey]!)
        .filter((x) => x !== undefined && x !== null)
    : currentAndPreviousData
        ?.map((entry) => entry[firstKey]!)
        .filter((x) => x !== undefined && x !== null);
  const total =
    allValues?.reduce((acc, curr) => {
      return acc + curr;
    }, 0) ?? 0;
  const average = total / (allValues?.length ?? 1);
  const hasLoaded = currentAndPreviousDataFilled?.length !== undefined;
  const gray400 = useColorRawValue("gray.400");

  // TODO: allow user to define the thresholds instead of hardcoded amounts
  const colorSet: RotatingColorSet = input.monitorGraph?.disabled
    ? "grayTones"
    : average > 0.8 || !hasLoaded
    ? "greenTones"
    : average < 0.4
    ? "redTones"
    : "orangeTones";

  const maxValue = isPassRate
    ? 1
    : Math.max(...(allValues && allValues.length > 0 ? allValues : [1]));

  return (
    <Box
      width="full"
      height="full"
      position="relative"
      border="1px solid"
      borderColor={getColor(colorSet, 0, -200)}
      backgroundColor={getColor(colorSet, 0, -400)}
      borderRadius="lg"
      paddingTop={2}
      overflow="hidden"
    >
      <VStack
        position="absolute"
        bottom={size === "md" ? 8 : 0}
        left={size === "md" ? 20 : 0}
        zIndex={1}
        padding={8}
        gap={2}
        align="start"
        color={getColor(colorSet, 0, 300)}
      >
        <HStack>
          {input.monitorGraph?.isGuardrail && (
            <Badge
              colorPalette="blue"
              variant="solid"
              size="sm"
              marginTop="-3px"
            >
              <LuShield size={16} />
              Guardrail
            </Badge>
          )}
          <Text fontSize="sm" fontWeight="medium" paddingBottom={1}>
            {name}
            {input.monitorGraph?.disabled && " (disabled)"}
          </Text>
        </HStack>
        <HStack gap={2}>
          <Text fontSize="2xl" fontWeight="bold">
            {hasLoaded ? (
              numeral(average).format(isPassRate ? "0%" : "0.[00]")
            ) : (
              <Skeleton
                width="56px"
                height="36px"
                backgroundColor={getColor(colorSet, 0, -100)}
              />
            )}
          </Text>
          <Text fontSize="xs">
            {isPassRate ? "Pass Rate" : "Average Score"}
          </Text>
        </HStack>
        <Text fontSize="xs">
          {filterParams.startDate &&
            filterParams.endDate &&
            (() => {
              const now = new Date().getTime();
              const daysDiff = Math.abs(
                Math.ceil((now - filterParams.endDate) / (1000 * 60 * 60 * 24))
              );
              const periodDays = Math.ceil(
                (filterParams.endDate - filterParams.startDate) /
                  (1000 * 60 * 60 * 24)
              );

              // If end date is within one day of today, show "Last X days"
              if (daysDiff <= 1) {
                return `Last ${periodDays} days`;
              }
              // Otherwise show date range
              else {
                return `${format(
                  new Date(filterParams.startDate),
                  "MMM d"
                )} - ${format(new Date(filterParams.endDate), "MMM d, yyyy")}`;
              }
            })()}
        </Text>
      </VStack>
      <ResponsiveContainer
        key={currentAndPreviousDataFilled ? input.graphId : "loading"}
        height={height_}
      >
        <AreaChart
          data={currentAndPreviousDataFilled}
          margin={
            size === "md"
              ? {
                  top: 10,
                  left: formatWith(yAxisValueFormat, maxValue).length * 6 - 5,
                  right: 24,
                }
              : {}
          }
        >
          {size === "md" && (
            <>
              <XAxis
                type="category"
                dataKey="date"
                name="Date"
                tickFormatter={formatDate}
                tickLine={false}
                axisLine={false}
                tick={{ fill: gray400 }}
              />
              <YAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickMargin={20}
                domain={[0, maxValue]}
                tick={{ fill: gray400 }}
                tickFormatter={(value) => {
                  if (typeof yAxisValueFormat === "function") {
                    return yAxisValueFormat(value);
                  }
                  return numeral(value).format(yAxisValueFormat);
                }}
              />
            </>
          )}
          {(sortedKeys ?? []).map((aggKey, index) => (
            <Area
              key={aggKey}
              type="monotone"
              dataKey={aggKey}
              stroke={getColor(colorSet, index, -300)}
              stackId={
                ["stacked_bar", "stacked_area"].includes(input.graphType)
                  ? "same"
                  : undefined
              }
              fill={getColor(colorSet, index, -300)}
              strokeWidth={2.5}
              dot={false}
              name={nameForSeries(aggKey)}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
