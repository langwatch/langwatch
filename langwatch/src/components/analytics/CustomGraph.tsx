import {
  Alert,
  Badge,
  Box,
  Flex,
  HStack,
  Skeleton,
  Spinner,
  type SystemStyleObject,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { format } from "date-fns";
import numeral from "numeral";
import React, { useCallback, useMemo } from "react";
import { LuShield } from "react-icons/lu";
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
import { useRouter } from "next/router";
import type { z } from "zod";
import type { FilterField } from "~/server/filters/types";
import { availableFilters } from "~/server/filters/registry";
import {
  useColorModeValue,
  useColorRawValue,
} from "../../components/ui/color-mode";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { buildMetadataFilterParams } from "../../utils/buildMetadataFilterParams";
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
import { Delayed } from "../Delayed";
import { usePeriodSelector } from "../PeriodSelector";
import { QuickwitNote } from "./QuickwitNote";
import { SummaryMetric } from "./SummaryMetric";

type Series = Unpacked<z.infer<typeof timeseriesSeriesInput>["series"]> & {
  name: string;
  colorSet: RotatingColorSet;
};

export type CustomGraphInput = {
  startDate?: number;
  endDate?: number;
  graphId: string;
  filters?: Record<FilterField, string[] | Record<string, string[]>>;
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
  groupByKey?: z.infer<typeof timeseriesSeriesInput>["groupByKey"];
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
    typeof LineChart | typeof PieChart,
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
  filters,
  onDataPointClick,
}: {
  input: CustomGraphInput;
  titleProps?: SystemStyleObject;
  hideGroupLabel?: boolean;
  size?: "sm" | "md";
  filters?: Record<FilterField, string[] | Record<string, string[]>>;
  onDataPointClick?: (params: {
    evaluatorId?: string;
    groupKey?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  }) => void;
}) {
  const publicEnv = usePublicEnv();

  if (
    publicEnv.data?.IS_QUICKWIT &&
    (input.series.some(
      (series) => !getMetric(series.metric).quickwitSupport || series.pipeline,
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
      filters={filters}
      onDataPointClick={onDataPointClick}
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
    filters,
    onDataPointClick,
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
    filters?: Record<FilterField, string[] | Record<string, string[]>>;
    onDataPointClick?: (params: {
      evaluatorId?: string;
      groupKey?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
    }) => void;
  }) {
    const height_ = input.height ?? 300;
    const { filterParams, queryOpts } = useFilterParams();
    const { daysDifference } = usePeriodSelector();
    const router = useRouter();
    const { project } = useOrganizationTeamProject();

    // Default handler for drill-down on pie/donut and summary bar charts
    const defaultOnDataPointClick = useCallback(
      (params: {
        evaluatorId?: string;
        groupKey?: string;
        date?: string;
        startDate?: string;
        endDate?: string;
      }) => {
        if (!project || !params.groupKey || !input.groupBy) {
          return;
        }

        // Build filter params based on groupBy field
        let filterParams: Record<string, string | string[]> = {};

        // Map groupBy to filter field and urlKey
        // Special case: metadata.model maps to spans.model filter (urlKey: "model")
        if (input.groupBy === "metadata.model") {
          filterParams.model = params.groupKey;
        } else if (input.groupBy.startsWith("metadata.")) {
          const metadataKey = input.groupBy.replace("metadata.", "");
          const metadataFilters = buildMetadataFilterParams(
            metadataKey,
            params.groupKey,
            params.groupKey,
          );
          filterParams = { ...filterParams, ...metadataFilters };
        } else if (input.groupBy === "sentiment.input_sentiment") {
          // Use sentiment filter (urlKey: "sentiment")
          filterParams.sentiment = params.groupKey;
        } else {
          // Look up the filter in the registry to get the correct urlKey
          const filter = availableFilters[input.groupBy as FilterField];
          if (filter) {
            // Use the filter's urlKey for the query parameter
            filterParams[filter.urlKey] = params.groupKey;
          } else {
            // Fallback: use groupBy as-is if not found in registry
            filterParams[input.groupBy] = params.groupKey;
          }
        }

        // Include active date range as ISO strings for navigation query
        if (params.startDate != null) {
          filterParams.startDate =
            typeof params.startDate === "number"
              ? new Date(params.startDate).toISOString()
              : String(params.startDate);
        }
        if (params.endDate != null) {
          filterParams.endDate =
            typeof params.endDate === "number"
              ? new Date(params.endDate).toISOString()
              : String(params.endDate);
        }

        // Navigate to messages page with filter
        void router.push(
          {
            pathname: `/${project.slug}/messages`,
            query: filterParams,
          },
          undefined,
          { shallow: false },
        );
      },
      [project, router, input.groupBy],
    );

    // Use custom handler if provided, otherwise use default for summary charts
    const handleDataPointClick = useMemo(() => {
      if (onDataPointClick) {
        return onDataPointClick;
      }
      // Enable default handler for pie/donut charts and summary bar charts
      if (
        ["pie", "donnut"].includes(input.graphType) ||
        (["bar", "horizontal_bar"].includes(input.graphType) &&
          input.timeScale === "full")
      ) {
        return defaultOnDataPointClick;
      }
      return undefined;
    }, [onDataPointClick, input.graphType, input.timeScale, defaultOnDataPointClick]);

    const timeScale = useMemo(() => {
      // Force "full" only for summary charts to get aggregated data
      // Pie and donut charts use numeric timeScale with pipeline (same as stacked charts)
      // When timeScale is a number with groupBy and no pipeline, the backend returns empty buckets
      // But with a pipeline, numeric timeScale works correctly
      const shouldUseFull = input.graphType === "summary";
      const timeScale_ = shouldUseFull
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

    // For pie and donut charts without a pipeline, add a default pipeline to get grouped data
    // The backend requires a pipeline to populate grouped buckets
    const queryInput = useMemo((): CustomGraphInput => {
      if (
        (input.graphType === "pie" || input.graphType === "donnut") &&
        input.groupBy &&
        !input.series.some((s) => s.pipeline)
      ) {
        // Helper to add pipeline while preserving literal types
        const addPipeline = (series: Series): Series => {
          // Explicitly construct object to preserve literal types
          const result = {
            metric: series.metric,
            aggregation: series.aggregation,
            key: series.key,
            subkey: series.subkey,
            filters: series.filters,
            asPercent: series.asPercent,
            name: series.name,
            colorSet: series.colorSet,
            pipeline: {
              field: "trace_id" as const,
              aggregation: "sum" as const,
            },
          } satisfies Series;
          return result;
        };

        return {
          ...input,
          series: input.series.map(addPipeline),
        };
      }
      return input;
    }, [input]);

    const timeseries = api.analytics.getTimeseries.useQuery(
      {
        ...filterParams,
        filters: {
          ...filterParams.filters,
          ...filters,
        },
        ...queryInput,
        timeScale,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { ...queryOpts, enabled: queryOpts.enabled && load },
    );

    // Use queryInput for shapeDataForGraph to match the query that was sent
    const currentAndPreviousData = shapeDataForGraph(queryInput, timeseries);
    const expectedKeys = Array.from(
      new Set(
        currentAndPreviousData?.flatMap((entry) =>
          Object.keys(entry).filter(
            (key) => key !== "date" && !key.startsWith("previous"),
          ),
        ) ?? [],
      ),
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
            : 0,
        );
    const keysToValues = Object.fromEntries(
      expectedKeys.map((key) => [
        key,
        currentAndPreviousDataFilled?.reduce(
          (acc, entry) => [...acc, entry[key]!],
          [] as number[],
        ) ?? [],
      ]),
    );
    const keysToSum = Object.fromEntries(
      Object.entries(keysToValues).map(([key, values]) => [
        key,
        values.reduce((acc, value) => acc + value, 0),
      ]),
    );

    const sortedKeys = expectedKeys
      .filter((key) => keysToSum[key]! !== 0)
      .toSorted((a, b) => {
        const totalA = keysToSum[a]!;
        const totalB = keysToSum[b]!;

        return totalB - totalA;
      });

    // Use queryInput.series for seriesByKey to match the keys generated from the query
    // This ensures donut charts with added pipeline have matching keys
    const seriesForKeyMapping = queryInput.series;
    const seriesByKey = Object.fromEntries(
      seriesForKeyMapping.map((series, index) => {
        const key = [
          index,
          series.metric,
          series.aggregation,
          series.pipeline?.field,
          series.pipeline?.aggregation,
          series.key,
        ]
          .filter((x) => x !== undefined && x !== "")
          .join("/");

        return [key, series];
      }),
    ) as unknown as Record<string, Series>;

    const nameForSeries = useCallback(
      (aggKey: string) => {
        const { series, groupKey } = getSeries(seriesByKey, aggKey);

        const group =
          input.groupBy && groupKey ? getGroup(input.groupBy) : undefined;
        const groupName = groupKey
          ? `${hideGroupLabel ? "" : group?.label.toLowerCase() + " "
          }${groupKey}`
          : "";
        return input.series.length > 1
          ? (series?.name ?? aggKey) + (groupName ? ` (${groupName})` : "")
          : groupName
            ? uppercaseFirstLetter(groupName)
              .replace("Evaluation passed passed", "Evaluation Passed")
              .replace("Evaluation passed failed", "Evaluation Failed")
              .replace("Contains error", "Traces")
              .replace(/^Evaluation label /i, "")
            : (series?.name ?? aggKey);
      },
      [seriesByKey, input.groupBy, input.series.length, hideGroupLabel],
    );

    // Calculate pie/donut data using shapeDataForSummary (same logic as summary charts)
    const pieData = useMemo(() => {
      if (input.graphType === "pie" || input.graphType === "donnut") {
        const summaryData = shapeDataForSummary(
          input,
          seriesByKey,
          timeseries,
          nameForSeries,
        );
        return summaryData.current.filter((item) => item.value > 0);
      }
      return [];
    }, [input, seriesByKey, timeseries, nameForSeries]);

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

        const colorIndex = colorMap[groupKey] ?? neutral;
        const color = getColor(colorSet, colorIndex);

        return color;
      }

      return getColor(colorSet, index);
    };

    const formatWith = (
      format: string | ((value: number) => string) | undefined,
      value: number,
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
        }),
      ),
    );
    const yAxisValueFormat = valueFormats.length === 1 ? valueFormats[0] : "";
    const allValues = Object.values(keysToValues).flatMap((values) => values);
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;

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
      payload: Payload<any, any>,
    ) => {
      if (payload.dataKey === "date") {
        return formatDate(value as string);
      }

      const { series } = getSeries(
        seriesByKey,
        payload.payload?.key ?? (payload.dataKey as string),
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
        nameForSeries,
      );

      // Create a map for key-based lookup to match current with previous values correctly
      const previousByKey = Object.fromEntries(
        summaryData.previous.map((p) => [p.key, p]),
      );

      const seriesSet = Object.fromEntries(
        input.series
          .toReversed()
          .map((series) => [
            series.metric +
            series.aggregation +
            series.pipeline?.field +
            series.pipeline?.aggregation,
            series,
          ]),
      );

      return container(
        <HStack
          gap={0}
          align="start"
          minHeight="101px"
          overflowX={"auto"}
          width="full"
        >
          <Flex
            paddingBottom={3}
            width="full"
            justifyContent="space-between"
            maxWidth={Object.entries(seriesSet).length * 142}
          >
            {timeseries.isLoading &&
              Object.entries(seriesSet).map(([key, series]) => (
                <SummaryMetric
                  key={key}
                  label={series.name}
                  titleProps={titleProps}
                />
              ))}
            {summaryData.current.slice(0, 10).map((entry) => (
              <SummaryMetric
                key={entry.key}
                label={entry.name}
                current={entry.value}
                previous={previousByKey[entry.key]?.value}
                format={entry.metric?.format}
                increaseIs={entry.metric?.increaseIs}
                titleProps={titleProps}
              />
            ))}
          </Flex>
        </HStack>,
      );
    }

    if (input.graphType === "pie" || input.graphType === "donnut") {
      return container(
        <ResponsiveContainer
          key={currentAndPreviousDataFilled ? input.graphId : "loading"}
          height={height_}
        >
          <PieChart>
            <Pie
              data={pieData}
              nameKey="name"
              dataKey="value"
              labelLine={false}
              label={pieChartPercentageLabel as any}
              innerRadius={input.graphType === "donnut" ? "50%" : 0}
              onClick={(data: any, index: number) => {
                if (handleDataPointClick && data && typeof index === "number" && pieData[index]) {
                  const entry = pieData[index]!;
                  const { series, groupKey } = getSeries(seriesByKey, entry.key);
                  // Derive evaluatorId from per-series metadata, fall back to groupByKey or first series key
                  const evaluatorId = series?.key || input.groupByKey || input.series[0]?.key;

                  handleDataPointClick({
                    evaluatorId,
                    groupKey,
                  });
                }
              }}
              style={{ cursor: handleDataPointClick ? "pointer" : "default" }}
            >
              {pieData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colorForSeries(entry.key, index)}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={tooltipValueFormatter}
              wrapperStyle={{ zIndex: 1000 }}
            />
            <Legend
              wrapperStyle={{
                padding: "0 2rem",
                maxHeight: "15%",
                overflow: "auto",
                zIndex: 1,
              }}
            />
          </PieChart>
        </ResponsiveContainer>,
      );
    }

    const [GraphComponent, GraphElement] = GraphComponentMap[input.graphType]!;

    const [XAxisComponent, YAxisComponent] = (
      input.graphType === "horizontal_bar" ? [YAxis, XAxis] : [XAxis, YAxis]
    ) as [typeof XAxis, typeof YAxis];

    if (
      ["bar", "horizontal_bar"].includes(input.graphType) &&
      input.timeScale === "full"
    ) {
      const summaryData = shapeDataForSummary(
        input,
        seriesByKey,
        timeseries,
        nameForSeries,
      );
      const sortedCurrentData = summaryData.current.toSorted(
        (a, b) => b.value - a.value,
      );

      const longestName = Math.max(
        ...summaryData.current.map((entry) => entry.name.length),
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
              interval={
                input.graphType === "horizontal_bar" ? 0 : undefined
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
              tickFormatter={(value: number) => {
                if (typeof yAxisValueFormat === "function") {
                  return yAxisValueFormat(value);
                }
                return numeral(value).format(yAxisValueFormat);
              }}
            />
            <Tooltip
              formatter={tooltipValueFormatter}
              wrapperStyle={{ zIndex: 1000 }}
            />
            <Bar
              dataKey="value"
              minPointSize={4}
              onClick={(item: any) => {
                if (handleDataPointClick && item && item.payload && item.payload.key) {
                  const key = item.payload.key;
                  const { series, groupKey } = getSeries(seriesByKey, key);
                  // Derive evaluatorId from per-series metadata, fall back to groupByKey or first series key
                  const evaluatorId = series?.key || input.groupByKey || input.series[0]?.key;

                  handleDataPointClick({
                    evaluatorId,
                    groupKey,
                  });
                }
              }}
              style={{ cursor: handleDataPointClick ? "pointer" : "default" }}
            >
              {summaryData.current.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colorForSeries(entry.key, index)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>,
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
        />,
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
            bottom: 0,
          }}
          // @ts-ignore
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
            tickFormatter={(value: number) => {
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
            wrapperStyle={{ zIndex: 1000 }}
          />
          <Legend
            wrapperStyle={{
              padding: "0 2rem",
              maxHeight: "15%",
              overflow: "auto",
              zIndex: 1,
            }}
          />
          {(sortedKeys ?? []).map((aggKey, index) => {
            const strokeColor = colorForSeries(aggKey, index);
            const fillColor = colorForSeries(aggKey, index);
            const { series, groupKey } = getSeries(seriesByKey, aggKey);
            // Derive evaluatorId from per-series metadata, fall back to groupByKey or first series key
            const evaluatorId = series?.key || input.groupByKey || input.series[0]?.key;

            return (
              <React.Fragment key={aggKey}>
                {/* @ts-ignore */}
                <GraphElement
                  key={aggKey}
                  type="linear"
                  dataKey={aggKey}
                  stroke={strokeColor}
                  stackId={
                    ["stacked_bar", "stacked_area"].includes(input.graphType)
                      ? "same"
                      : undefined
                  }
                  fill={fillColor}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={
                    input.graphType !== "scatter" ? { r: 8 } : undefined
                  }
                  name={nameForSeries(aggKey)}
                  line={
                    input.graphType === "scatter" && input.connected
                      ? true
                      : undefined
                  }
                  onClick={(data: any) => {
                    if (onDataPointClick && data) {
                      // Extract date from data - check multiple possible locations
                      let date: string | undefined;
                      if (["bar", "stacked_bar", "horizontal_bar"].includes(input.graphType)) {
                        // For bar charts, check multiple possible locations for the date
                        date = data.payload?.date || data.date || data.activePayload?.[0]?.payload?.date;
                      } else {
                        // For other chart types (line, area, etc.), use existing logic
                        date = data.date || data.payload?.date;
                      }

                      // Calculate date range based on timeScale for bar charts (not summary)
                      let startDate: string | undefined;
                      let endDate: string | undefined;
                      if (
                        date &&
                        ["bar", "stacked_bar", "horizontal_bar"].includes(input.graphType) &&
                        typeof timeScale === "number"
                      ) {
                        const clickedDate = new Date(date);
                        startDate = clickedDate.toISOString();
                        // Calculate endDate by adding the timeScale in minutes
                        const endDateObj = new Date(clickedDate.getTime() + timeScale * 60 * 1000);
                        endDate = endDateObj.toISOString();
                      }

                      onDataPointClick({
                        evaluatorId,
                        groupKey,
                        date,
                        startDate,
                        endDate,
                      });
                    }
                  }}
                  style={{ cursor: onDataPointClick ? "pointer" : "default" }}
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
            );
          })}
        </GraphComponent>
      </ResponsiveContainer>,
    );
  },
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.input) === JSON.stringify(nextProps.input) &&
      JSON.stringify(prevProps.titleProps) ===
      JSON.stringify(nextProps.titleProps) &&
      prevProps.onDataPointClick === nextProps.onDataPointClick
    );
  },
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

  // Try exact match first
  let series = seriesByKey[seriesKey];

  // If no exact match, try to find a series that starts with the seriesKey
  // This handles cases where the aggKey doesn't include the series.key suffix
  if (!series) {
    const matchingKey = Object.keys(seriesByKey).find(
      (key) => key.startsWith(seriesKey + "/") || key === seriesKey,
    );
    if (matchingKey) {
      series = seriesByKey[matchingKey];
    }
  }

  return { series, groupKey };
};

const shapeDataForGraph = (
  input: CustomGraphInput,
  timeseries: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["analytics"]["getTimeseries"],
    TRPCClientErrorLike<AppRouter>
  >,
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
            ([key, value]) => [`previous>${key}`, value ?? 0],
          ),
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
  nameForSeries: (aggKey: string) => string,
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

      // Sum all values across all time periods for summary charts
      const totalValue = values.reduce((sum, value) => sum + (value ?? 0), 0);

      return {
        key: aggKey,
        name: nameForSeries(aggKey),
        metric,
        value: totalValue,
      };
    });
  };

  return {
    current: reduceToSummary(collectedCurrent),
    previous: reduceToSummary(collectedPrevious),
  };
};

const collectAllDays = (
  data: ({ date: string } & Record<string, number>)[],
) => {
  const result: Record<string, number[]> = {};

  for (const entry of data) {
    for (const key of Object.keys(entry)) {
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
  >["currentPeriod"],
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

      // Handle case where buckets might be empty or undefined
      if (!buckets || Object.keys(buckets).length === 0) {
        return {
          date: entry.date,
        };
      }

      const aggregations = Object.fromEntries(
        Object.entries(buckets).flatMap(([bucketKey, bucket]) => {
          return Object.entries(bucket).map(([metricKey, metricValue]) => {
            return [`${bucketKey}>${metricKey}`, metricValue ?? 0];
          });
        }),
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
  fillWith = 0,
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
    opacity: number,
  ) => string;
  size?: "sm" | "md";
  filterParams: ReturnType<typeof useFilterParams>["filterParams"];
  height_: number;
  formatWith: (
    format: string | ((value: number) => string) | undefined,
    value: number,
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

  // Color adjustments for light/dark mode
  // Light mode: light backgrounds, dark text
  // Dark mode: dark backgrounds, light text
  const bgAdjustment = useColorModeValue(-400, 200);
  const borderAdjustment = useColorModeValue(-200, 100);
  const textAdjustment = useColorModeValue(300, -300);
  const areaAdjustment = useColorModeValue(-300, 100);
  const skeletonAdjustment = useColorModeValue(-100, 100);

  // Glow effect for dark mode based on colorSet
  const glowColor = getColor(colorSet, 0, 0);
  const boxShadow = useColorModeValue(
    "none",
    `0 0 20px ${glowColor}40, 0 0 40px ${glowColor}20`,
  );

  return (
    <Box
      width="full"
      height="full"
      position="relative"
      border="1px solid"
      borderColor={getColor(colorSet, 0, borderAdjustment)}
      backgroundColor={getColor(colorSet, 0, bgAdjustment)}
      borderRadius="lg"
      paddingTop={2}
      overflow="hidden"
      boxShadow={boxShadow}
    >
      <VStack
        position="absolute"
        bottom={size === "md" ? 8 : 0}
        left={size === "md" ? 20 : 0}
        zIndex={1}
        padding={8}
        gap={2}
        align="start"
        color={getColor(colorSet, 0, textAdjustment)}
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
                backgroundColor={getColor(colorSet, 0, skeletonAdjustment)}
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
                Math.ceil((now - filterParams.endDate) / (1000 * 60 * 60 * 24)),
              );
              const periodDays = Math.ceil(
                (filterParams.endDate - filterParams.startDate) /
                (1000 * 60 * 60 * 24),
              );

              // If end date is within one day of today, show "Last X days"
              if (daysDiff <= 1) {
                return `Last ${periodDays} days`;
              }
              // Otherwise show date range
              else {
                return `${format(
                  new Date(filterParams.startDate),
                  "MMM d",
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
              stroke={getColor(colorSet, index, areaAdjustment)}
              stackId={
                ["stacked_bar", "stacked_area"].includes(input.graphType)
                  ? "same"
                  : undefined
              }
              fill={getColor(colorSet, index, areaAdjustment)}
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
