import type { AnalyticsTimeseriesResult } from "@langwatch/analytics-contract";
import { trpcQueryKey } from "@langwatch/api/web";
import { useReadFreshness } from "@langwatch/browser-host/read-freshness";
import {
  resolveGraphTimeScale,
  withGroupedPipeline,
  type CustomGraphInput,
} from "@langwatch/dashboard-contract";
import { CachedView } from "@langwatch/design-system/cached-view";
import { useColorModeValue, useColorRawValue } from "@langwatch/design-system/color-mode";
import {
  Badge,
  Box,
  Flex,
  HStack,
  Skeleton,
  Spinner,
  type SystemStyleObject,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { RotatingColorSet } from "@langwatch/design-system/rotating-colors";
import { nowInstant } from "@langwatch/time";
import numeral from "numeral";
import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
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
  type PieLabelRenderProps,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Formatter,
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

import { analyticsApi } from "../../behavior/analytics-api.ts";
import { useDashboardRefetchInterval } from "../../behavior/use-dashboard-auto-refresh.ts";
import { useAnalyticsPeriod } from "../../behavior/use-analytics-period.ts";
import { useFilterParams } from "../../behavior/use-filter-params.ts";
import { useGetRotatingColorForCharts } from "../../behavior/use-rotating-chart-color.ts";
import type { FilterField } from "../../model/analytics-filter-definition.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { getGroup, getMetric } from "../../model/analytics-registry.ts";
import { formatChartDate } from "../../model/chart-date.ts";
import {
  clickedBucketRange,
  clickedDate,
  type DataPointClickParams,
  drillDownQuery,
  drillsDownByDefault,
  isBarGraph,
  seriesColorIndex,
} from "../../model/custom-graph-drill-down.ts";
import { describeError } from "../../model/describe-error.ts";
import { monitorPeriodLabel, summarizeMonitor } from "../../model/monitor-summary.ts";
import { formatSeriesGroupName, formatSingleSeriesName } from "../../model/series-group-name.ts";
import { resolveSeriesValueFormat } from "../../model/series-value-format.ts";
import { ChartErrorState } from "../elements/chart-error-state.tsx";
import { ChartTooltip } from "../elements/chart-tooltip.tsx";
import { Delayed } from "../elements/delayed.tsx";
import { SummaryMetric } from "../elements/summary-metric.tsx";

export type { CustomGraphInput };

type Series = CustomGraphInput["series"][number];

/**
 * The charted read, as the shaping helpers below take it: stated
 * structurally, not as `UseTRPCQueryResult<...>` (a governed screen may
 * not import it) — the payload is the analytics contract's own type.
 */
type TimeseriesQuery = {
  data: AnalyticsTimeseriesResult | undefined;
  error: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

/** One charted bucket: its date, and a value per series key. */
type GraphRow = { date: string; [seriesKey: string]: number | string };

type TimeseriesBucket = NonNullable<TimeseriesQuery["data"]>["currentPeriod"][number];

/**
 * A drill-down address, as one query string. The host port takes a path
 * rather than an object to serialise. A list value stays comma-joined, as
 * every trace explorer filter reads its own parameter.
 */
function toQueryString(params: Record<string, string | string[]>): string {
  return Object.entries(params)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          Array.isArray(value) ? value.join(",") : value,
        )}`,
    )
    .join("&");
}

export const summaryGraphTypes: CustomGraphInput["graphType"][] = ["summary", "pie", "donnut"];

/**
 * The floor a row of figures holds, in pixels — the tallest form (label,
 * number, and a change line once comparison arrives), so the row never
 * resizes as data lands. `input.height` sizes a plotting area; this has none.
 */
const SUMMARY_ROW_MIN_HEIGHT = "101px";

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
  emptyState,
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
  emptyState?: React.ReactNode;
}) {
  return (
    <CustomGraph_
      input={input}
      titleProps={titleProps}
      hideGroupLabel={hideGroupLabel}
      filters={filters}
      onDataPointClick={onDataPointClick}
      emptyState={emptyState}
    />
  );
}

type DataPointClick = (params: DataPointClickParams) => void;

type GraphTitleProps = {
  fontSize?: SystemStyleObject["fontSize"];
  textStyle?: SystemStyleObject["textStyle"];
  color?: SystemStyleObject["color"];
  fontWeight?: SystemStyleObject["fontWeight"];
};

type ChartTimeseries = Omit<TimeseriesQuery, "refetch"> & {
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};
type RotatingColor = ReturnType<typeof useGetRotatingColorForCharts>;
type ValueFormat = string | ((value: number) => string) | undefined;
type SeriesColor = (aggKey: string, index: number) => string;
type NameForSeries = (aggKey: string) => string;

/**
 * Which series the reader has clicked out of the legend: component state, not browser storage
 * (`ui-screen-closure`). A different chart, or a different project, starts with nothing hidden.
 */
function useSeriesVisibility(scope: string) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setHiddenSeries(new Set());
  }, [scope]);

  const toggleSeries = useCallback((dataKey: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(dataKey)) {
        next.delete(dataKey);
      } else {
        next.add(dataKey);
      }
      return next;
    });
  }, []);

  return { hiddenSeries, toggleSeries };
}

/** The caller's click handler, or the Trace Explorer drill-down for the charts that have one. */
function useDataPointClick({
  input,
  onDataPointClick,
}: {
  input: CustomGraphInput;
  onDataPointClick: DataPointClick | undefined;
}): DataPointClick | undefined {
  const host = useAnalyticsHost();
  const project = host.project();
  const { groupBy } = input;

  const drillDown = useCallback(
    (params: DataPointClickParams) => {
      if (!project || !params.groupKey || !groupBy) return;
      // The whole query is written into the address rather than merged: the trace explorer is
      // a different page, and none of this page's parameters mean anything there.
      const query = drillDownQuery({
        groupBy,
        groupKey: params.groupKey,
        startDate: params.startDate,
        endDate: params.endDate,
      });
      host.navigate(`/${project.slug}/traces?${toQueryString(query)}`);
    },
    [project, host, groupBy],
  );

  const byDefault = drillsDownByDefault({ graphType: input.graphType, timeScale: input.timeScale });
  return useMemo(() => {
    if (onDataPointClick) return onDataPointClick;
    return byDefault ? drillDown : undefined;
  }, [onDataPointClick, byDefault, drillDown]);
}

/** The charted read, and the one-bucket read a monitor card headlines. */
function useGraphTimeseries({
  input,
  queryInput,
  timeScale,
  filters,
  load,
}: {
  input: CustomGraphInput;
  queryInput: CustomGraphInput;
  timeScale: "full" | number;
  filters: CustomGraphInput["filters"];
  load: boolean;
}) {
  const { filterParams, queryOpts } = useFilterParams();
  const refetchInterval = useDashboardRefetchInterval();
  const query = {
    ...filterParams,
    filters: { ...filterParams.filters, ...filters },
    ...queryInput,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const timeseriesInput = { ...query, timeScale };
  const timeseries = analyticsApi.analytics.getTimeseries.useQuery(timeseriesInput, {
    ...queryOpts,
    enabled: queryOpts.enabled && load,
    refetchInterval,
  });
  const freshness = useReadFreshness({
    queryKey: trpcQueryKey("analytics.getTimeseries", { input: timeseriesInput, type: "query" }),
  });
  // A monitor card headlines the whole period as one "full" bucket, which run-weights it;
  // averaging daily buckets would weigh a 1-run day like a 100-run day.
  const monitorSummaryTimeseries = analyticsApi.analytics.getTimeseries.useQuery(
    { ...query, timeScale: "full" },
    {
      ...queryOpts,
      enabled: queryOpts.enabled && load && input.graphType === "monitor_graph",
      refetchInterval,
    },
  );
  return { timeseries, monitorSummaryTimeseries, filterParams, freshness };
}

function isPassRateMonitor(input: CustomGraphInput): boolean {
  return (
    input.graphType === "monitor_graph" && Boolean(input.series[0]?.metric.includes("pass_rate"))
  );
}

/** The rows the chart draws, the series keys by weight, and every finite value it plots. */
function graphRowsOf({
  input,
  queryInput,
  timeseries,
}: {
  input: CustomGraphInput;
  queryInput: CustomGraphInput;
  timeseries: TimeseriesQuery;
}) {
  const rows = shapeDataForGraph(queryInput, timeseries);
  const expectedKeys = Array.from(
    new Set(
      rows?.flatMap((entry) =>
        Object.keys(entry).filter((key) => key !== "date" && !key.startsWith("previous")),
      ) ?? [],
    ),
  );
  const keepsGaps = input.graphType === "scatter" || input.graphType === "line";
  const filledRows = keepsGaps
    ? rows
    : fillEmptyData(rows, expectedKeys, isPassRateMonitor(input) ? 1 : 0);
  const keysToValues = Object.fromEntries(
    expectedKeys.map((key) => [key, filledRows?.map((entry) => chartedValue(entry[key])) ?? []]),
  );
  const keysToSum = Object.fromEntries(
    Object.entries(keysToValues).map(([key, values]) => [
      key,
      values.reduce((acc, value) => acc + value, 0),
    ]),
  );
  const sortedKeys = [...expectedKeys].toSorted(
    (a, b) => (keysToSum[b] ?? 0) - (keysToSum[a] ?? 0),
  );
  const allValues = Object.values(keysToValues).flat().filter(Number.isFinite);
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;

  return { rows, filledRows, sortedKeys, allValues, maxValue };
}

function seriesKeyOf(series: Series, index: number): string {
  return [
    index,
    series.metric,
    series.aggregation,
    series.pipeline?.field,
    series.pipeline?.aggregation,
    series.key,
  ]
    .filter((x) => x !== undefined && x !== "")
    .join("/");
}

/** Each series by the key the query answers with, and the legend name of a series key. */
function useSeriesNaming({
  input,
  queryInput,
  hideGroupLabel,
}: {
  input: CustomGraphInput;
  queryInput: CustomGraphInput;
  hideGroupLabel: boolean;
}) {
  // The query's own series, so a donut's added pipeline yields matching keys.
  const seriesByKey = Object.fromEntries(
    queryInput.series.map((series, index): [string, Series] => [
      seriesKeyOf(series, index),
      series,
    ]),
  );

  const nameForSeries = useCallback(
    (aggKey: string) => {
      const { series, groupKey } = getSeries(seriesByKey, aggKey);
      const groupName = formatSeriesGroupName({
        groupBy: input.groupBy,
        groupKey,
        groupLabel: input.groupBy ? getGroup(input.groupBy)?.label : undefined,
        hideGroupLabel,
      });
      const seriesName = series?.name ?? aggKey;
      if (input.series.length > 1) return groupName ? `${seriesName} (${groupName})` : seriesName;
      return groupName ? formatSingleSeriesName(groupName) : seriesName;
    },
    [seriesByKey, input.groupBy, input.series.length, hideGroupLabel],
  );

  return { seriesByKey, nameForSeries };
}

/** Pie and donut slices, as the summary charts total them, dropping the empty ones. */
function usePieData({
  input,
  seriesByKey,
  timeseries,
  nameForSeries,
}: {
  input: CustomGraphInput;
  seriesByKey: Record<string, Series>;
  timeseries: TimeseriesQuery;
  nameForSeries: NameForSeries;
}) {
  return useMemo(() => {
    if (input.graphType !== "pie" && input.graphType !== "donnut") return [];
    const summaryData = shapeDataForSummary({ input, seriesByKey, timeseries, nameForSeries });
    return summaryData.current.filter((item) => item.value > 0);
  }, [input, seriesByKey, timeseries, nameForSeries]);
}

function useChartPalette() {
  return {
    getColor: useGetRotatingColorForCharts(),
    areaFillOpacity: useColorModeValue(0.3, 0.15),
    gray400: useColorRawValue("gray.400"),
    gridColor: useColorModeValue("rgba(0, 0, 0, 0.08)", "rgba(255, 255, 255, 0.08)"),
    cursorColor: useColorModeValue("rgba(0, 0, 0, 0.1)", "rgba(255, 255, 255, 0.1)"),
  };
}

function colorForSeriesOf({
  seriesByKey,
  getColor,
}: {
  seriesByKey: Record<string, Series>;
  getColor: RotatingColor;
}): SeriesColor {
  return (aggKey, index) => {
    const { series, groupKey } = getSeries(seriesByKey, aggKey);
    const colorSet: RotatingColorSet = series?.colorSet ?? "grayTones";
    return getColor(colorSet, seriesColorIndex({ colorSet, groupKey, index }));
  };
}

function formatWith(format: ValueFormat, value: number) {
  if (typeof format === "function") return format(value);
  return numeral(value).format(format ?? "0a");
}

function valueFormatOf(series: Series): string | ((value: number) => string) {
  return (
    resolveSeriesValueFormat({
      isPercent: series.asPercent,
      aggregation: series.aggregation,
      metricFormat: getMetric(series.metric)?.format,
    }) ?? "0a"
  );
}

function yAxisValueFormatOf(series: Series[]): ValueFormat {
  const valueFormats = Array.from(new Set(series.map(valueFormatOf)));
  return valueFormats.length === 1 ? valueFormats[0] : "";
}

function tooltipFormatterOf({
  seriesByKey,
  formatDate,
}: {
  seriesByKey: Record<string, Series>;
  formatDate: (date: string) => string;
}): Formatter<ValueType, NameType> {
  return (value, _, payload) => {
    if (payload.dataKey === "date") return formatDate(String(value));
    const payloadKey: unknown = payload.payload?.key;
    const dataKey = typeof payload.dataKey === "string" ? payload.dataKey : "";
    const seriesKey = typeof payloadKey === "string" ? payloadKey : dataKey;
    const { series } = getSeries(seriesByKey, seriesKey);
    const metric = series?.metric && getMetric(series.metric);
    const effectiveFormat = resolveSeriesValueFormat({
      isPercent: series?.asPercent,
      aggregation: series?.aggregation,
      metricFormat: metric ? metric.format : undefined,
    });
    return formatWith(effectiveFormat, Number(value));
  };
}

function evaluatorIdFor({
  series,
  input,
}: {
  series: Series | undefined;
  input: CustomGraphInput;
}): string | undefined {
  // Per-series metadata first, then the group's key, then the first series.
  return series?.key || input.groupByKey || input.series[0]?.key;
}

function graphIsEmpty({
  graphType,
  timeseries,
  allValues,
  rows,
}: {
  graphType: CustomGraphInput["graphType"];
  timeseries: TimeseriesQuery;
  allValues: number[];
  rows: GraphRow[] | undefined;
}): boolean {
  if (timeseries.isLoading || !timeseries.data) return false;
  if (allValues.length === 0 || rows?.length === 0) return true;
  return !summaryGraphTypes.includes(graphType) && allValues.every((v) => v === 0);
}

const SKELETON_BARS = [35, 55, 25, 70, 45, 65, 40, 55, 30, 60, 50, 35];
const EMPTY_BARS = [40, 65, 30, 80, 50, 70, 45, 60];

function ChartLoadingSkeleton({ height_ }: { height_: number }) {
  return (
    <Box position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center">
      <HStack gap={1} align="end" opacity={0.15}>
        {SKELETON_BARS.map((h, i) => (
          <Skeleton
            key={i}
            width="8px"
            height={`${h}%`}
            maxHeight={`${(h / 100) * (height_ - 40)}px`}
            borderRadius="sm"
          />
        ))}
      </HStack>
    </Box>
  );
}

function EmptyChart() {
  return (
    <VStack position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)" gap={2}>
      <HStack gap={1} align="end" opacity={0.3}>
        {EMPTY_BARS.map((h, i) => (
          <Box
            key={i}
            width="6px"
            height={`${h}%`}
            maxHeight="40px"
            bg="border"
            borderRadius="sm"
          />
        ))}
      </HStack>
      <Text textStyle="xs" color="fg.subtle">
        No data. Try adjusting the date range.
      </Text>
    </VStack>
  );
}

/** Stale data stays up with a retry badge; its one-line `title` is what `describeError` is for. */
function StaleDataRetry({ timeseries }: { timeseries: ChartTimeseries }) {
  return (
    <button
      type="button"
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        zIndex: 1,
        cursor: "pointer",
        background: "none",
        border: "none",
        padding: 0,
      }}
      aria-label="Retry loading chart data"
      onClick={() => void timeseries.refetch()}
      title={describeError({
        error: timeseries.error,
        fallbackTitle: "Couldn't refresh this chart",
      })}
    >
      <Badge colorPalette="red" variant="solid" fontSize="xs">
        Refresh failed: click to retry
      </Badge>
    </button>
  );
}

/**
 * Loading, refetching, failure and empty states around a chart. A summary draws its own
 * per-figure placeholders, so it gets no bar-chart skeleton behind them.
 */
function GraphContainer({
  graphType,
  timeseries,
  isEmpty,
  height_,
  emptyState,
  children,
}: {
  graphType: CustomGraphInput["graphType"];
  timeseries: ChartTimeseries;
  isEmpty: boolean;
  height_: number;
  emptyState: React.ReactNode;
  children: React.ReactNode;
}) {
  const failedOutright = Boolean(timeseries.error) && !timeseries.data;
  const showEmpty = isEmpty && graphType !== "monitor_graph";
  return (
    <Box width="full" height="full" position="relative">
      {timeseries.isLoading && graphType !== "summary" && (
        <ChartLoadingSkeleton height_={height_} />
      )}
      {timeseries.isFetching && !timeseries.isLoading && (
        <Delayed>
          <Spinner position="absolute" right={4} top={4} />
        </Delayed>
      )}
      {failedOutright ? (
        <ChartErrorState error={timeseries.error} onRetry={() => void timeseries.refetch()} />
      ) : (
        <>
          {Boolean(timeseries.error) && <StaleDataRetry timeseries={timeseries} />}
          {showEmpty ? (emptyState ?? <EmptyChart />) : children}
        </>
      )}
    </Box>
  );
}

function SummaryGraph({
  input,
  seriesByKey,
  timeseries,
  nameForSeries,
  titleProps,
}: {
  input: CustomGraphInput;
  seriesByKey: Record<string, Series>;
  timeseries: TimeseriesQuery;
  nameForSeries: NameForSeries;
  titleProps: GraphTitleProps | undefined;
}) {
  const summaryData = shapeDataForSummary({ input, seriesByKey, timeseries, nameForSeries });
  // Keyed, so each current value meets its own previous one.
  const previousByKey = Object.fromEntries(summaryData.previous.map((p) => [p.key, p]));
  const seriesSet = Object.fromEntries(
    input.series
      .slice()
      .reverse()
      .map((series) => [
        series.metric + series.aggregation + series.pipeline?.field + series.pipeline?.aggregation,
        series,
      ]),
  );

  return (
    <HStack gap={0} align="start" minHeight={SUMMARY_ROW_MIN_HEIGHT} overflowX="auto" width="full">
      <Flex paddingBottom={3} width="full" gap={0}>
        {timeseries.isLoading &&
          Object.entries(seriesSet).map(([key, series]) => (
            <SummaryMetric key={key} label={series.name} titleProps={titleProps} />
          ))}
        {summaryData.current.slice(0, 10).map((entry) => (
          <SummaryMetric
            key={entry.key}
            label={entry.name}
            current={entry.value}
            previous={previousByKey[entry.key]?.value}
            format={entry.metric?.format}
            increaseIs={entry.metric?.increaseIs}
            noDataUrl={entry.noDataUrl}
            titleProps={titleProps}
          />
        ))}
      </Flex>
    </HStack>
  );
}

function PieGraph({
  input,
  pieData,
  chartKey,
  height_,
  seriesByKey,
  handleDataPointClick,
  colorForSeries,
  tooltipValueFormatter,
}: {
  input: CustomGraphInput;
  pieData: ReturnType<typeof usePieData>;
  chartKey: string;
  height_: number;
  seriesByKey: Record<string, Series>;
  handleDataPointClick: DataPointClick | undefined;
  colorForSeries: SeriesColor;
  tooltipValueFormatter: Formatter<ValueType, NameType>;
}) {
  const onSliceClick = (data: unknown, index: number) => {
    const entry = pieData[index];
    if (!handleDataPointClick || !data || !entry) return;
    const { series, groupKey } = getSeries(seriesByKey, entry.key);
    handleDataPointClick({ evaluatorId: evaluatorIdFor({ series, input }), groupKey });
  };

  return (
    <ResponsiveContainer key={chartKey} height={height_}>
      <PieChart>
        <Pie
          data={pieData}
          nameKey="name"
          dataKey="value"
          labelLine={false}
          label={pieChartPercentageLabel}
          innerRadius={input.graphType === "donnut" ? "50%" : 0}
          onClick={onSliceClick}
          style={{ cursor: handleDataPointClick ? "pointer" : "default" }}
        >
          {pieData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colorForSeries(entry.key, index)} />
          ))}
        </Pie>
        <Tooltip
          content={<ChartTooltip />}
          formatter={tooltipValueFormatter}
          wrapperStyle={{ zIndex: 1000 }}
        />
        <Legend wrapperStyle={{ padding: "0 2rem", flexWrap: "wrap", zIndex: 1, fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function axesFor(graphType: CustomGraphInput["graphType"]) {
  return (graphType === "horizontal_bar" ? [YAxis, XAxis] : [XAxis, YAxis]) as [
    typeof XAxis,
    typeof YAxis,
  ];
}

function legendSeriesKey(dataKey: unknown): string | undefined {
  return typeof dataKey === "string" ? dataKey.replace(/^previous>/, "") : undefined;
}

function yTickFormatter(format: ValueFormat) {
  return (value: number) =>
    typeof format === "function" ? format(value) : numeral(value).format(format);
}

type SeriesContext = {
  input: CustomGraphInput;
  uniqueId: string;
  hiddenSeries: Set<string>;
  seriesByKey: Record<string, Series>;
  colorForSeries: SeriesColor;
  nameForSeries: NameForSeries;
  onDataPointClick: DataPointClick | undefined;
  timeScale: "full" | number;
};

function seriesClickHandler({
  context,
  aggKey,
}: {
  context: SeriesContext;
  aggKey: string;
}): (data: unknown) => void {
  const { input, onDataPointClick, timeScale, seriesByKey } = context;
  return (data) => {
    if (!onDataPointClick || !data) return;
    const { series, groupKey } = getSeries(seriesByKey, aggKey);
    const date = clickedDate({ data, graphType: input.graphType });
    onDataPointClick({
      evaluatorId: evaluatorIdFor({ series, input }),
      groupKey,
      date,
      ...clickedBucketRange({ date, graphType: input.graphType, timeScale }),
    });
  };
}

/** One series of a cartesian chart, and its dashed previous-period twin when compared. */
function renderSeries({
  context,
  aggKey,
  index,
}: {
  context: SeriesContext;
  aggKey: string;
  index: number;
}) {
  const { input, uniqueId, hiddenSeries, colorForSeries, nameForSeries } = context;
  const color = colorForSeries(aggKey, index);
  const isAreaType = input.graphType === "area" || input.graphType === "stacked_area";
  const isBarType = isBarGraph(input.graphType);
  const isScatter = input.graphType === "scatter";
  const stackId =
    input.graphType === "stacked_bar" || input.graphType === "stacked_area" ? "same" : undefined;
  const isHidden = hiddenSeries.has(aggKey);
  const [, GraphElement] = GraphComponentMap[input.graphType]!;
  // Rounded tops only on bars that are not stacked.
  const extraProps: Record<string, unknown> =
    isBarType && input.graphType !== "stacked_bar" ? { radius: [3, 3, 0, 0] } : {};

  return (
    <React.Fragment key={aggKey}>
      {/* @ts-expect-error - GraphElement is Line|Bar|Area|Scatter, props are Bar-only */}
      <GraphElement
        key={aggKey}
        type="monotone"
        hide={isHidden}
        dataKey={aggKey}
        stroke={color}
        stackId={stackId}
        fill={isAreaType ? `url(#gradient-${uniqueId}-${index})` : color}
        fillOpacity={isBarType ? 0.8 : undefined}
        {...extraProps}
        strokeWidth={isBarType ? 0 : 2.5}
        dot={false}
        activeDot={isScatter ? undefined : { r: 8 }}
        name={nameForSeries(aggKey)}
        line={isScatter && input.connected ? true : undefined}
        onClick={seriesClickHandler({ context, aggKey })}
        style={{ cursor: context.onDataPointClick ? "pointer" : "default" }}
      />
      {input.includePrevious && (
        // @ts-expect-error `GraphElement` is one of five recharts series types
        // chosen at runtime; their prop unions do not intersect.
        <GraphElement
          key={"previous>" + aggKey}
          type="monotone"
          hide={isHidden}
          dataKey={"previous>" + aggKey}
          stackId={stackId}
          stroke={color + "99"}
          fill={color + "99"}
          strokeWidth={2.5}
          strokeDasharray={isScatter ? undefined : "5 5"}
          dot={false}
          activeDot={isScatter ? undefined : { r: 8 }}
          name={"Previous " + nameForSeries(aggKey)}
          line={isScatter && input.connected ? true : undefined}
        />
      )}
    </React.Fragment>
  );
}

function CartesianGraph({
  context,
  rows,
  sortedKeys,
  maxValue,
  yAxisValueFormat,
  palette,
  formatDate,
  tooltipValueFormatter,
  toggleSeries,
  chartKey,
  height_,
}: {
  context: SeriesContext;
  rows: GraphRow[] | undefined;
  sortedKeys: string[];
  maxValue: number;
  yAxisValueFormat: ValueFormat;
  palette: ReturnType<typeof useChartPalette>;
  formatDate: (date: string) => string;
  tooltipValueFormatter: Formatter<ValueType, NameType>;
  toggleSeries: (dataKey: string) => void;
  chartKey: string;
  height_: number;
}) {
  const { input, uniqueId, hiddenSeries, colorForSeries } = context;
  const [GraphComponent] = GraphComponentMap[input.graphType]!;
  const [XAxisComponent, YAxisComponent] = axesFor(input.graphType);

  return (
    <ResponsiveContainer key={chartKey} height={height_}>
      <GraphComponent
        data={rows}
        margin={{
          top: 10,
          left: formatWith(yAxisValueFormat, maxValue).length * 6 - 5,
          right: 24,
          bottom: 0,
        }}
        // @ts-expect-error `layout` is declared per chart component and this one is
        // resolved from the graph type, so the union is wider than any single chart.
        layout={input.graphType === "horizontal_bar" ? "vertical" : undefined}
      >
        <defs>
          {sortedKeys.map((aggKey, index) => (
            <linearGradient
              key={`gradient-${aggKey}`}
              id={`gradient-${uniqueId}-${index}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={colorForSeries(aggKey, index)}
                stopOpacity={palette.areaFillOpacity}
              />
              <stop offset="100%" stopColor={colorForSeries(aggKey, index)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid
          vertical={input.graphType === "scatter"}
          strokeDasharray="5 7"
          stroke={palette.gridColor}
        />
        <XAxisComponent
          type="category"
          dataKey="date"
          name="Date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tick={{ fill: palette.gray400 }}
          style={{ fontSize: "11px" }}
        />
        <YAxisComponent
          type="number"
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickMargin={20}
          domain={[0, (dataMax: number) => (dataMax > 0 ? dataMax : 1)]}
          tick={{ fill: palette.gray400 }}
          style={{ fontSize: "11px" }}
          tickFormatter={yTickFormatter(yAxisValueFormat)}
        />
        <Tooltip
          content={<ChartTooltip />}
          formatter={tooltipValueFormatter}
          cursor={{ fill: palette.cursorColor }}
          labelFormatter={(_label, payload) => {
            if (input.graphType === "scatter") return "";
            const previousDate = payload[1]?.payload["previous>date"];
            const comparison =
              input.includePrevious && previousDate ? " vs " + formatDate(previousDate) : "";
            return formatDate(payload[0]?.payload.date) + comparison;
          }}
          wrapperStyle={{ zIndex: 1000 }}
        />
        <Legend
          wrapperStyle={{
            padding: "0 2rem",
            flexWrap: "wrap",
            zIndex: 1,
            cursor: "pointer",
            fontSize: 11,
          }}
          onClick={(e) => {
            const key = legendSeriesKey(e.dataKey);
            if (key) toggleSeries(key);
          }}
          formatter={(value, entry) => {
            const seriesKey = legendSeriesKey(entry.dataKey);
            const isHidden = seriesKey !== undefined && hiddenSeries.has(seriesKey);
            return <span style={{ opacity: isHidden ? 0.3 : 1 }}>{value}</span>;
          }}
        />
        {sortedKeys.map((aggKey, index) => renderSeries({ context, aggKey, index }))}
      </GraphComponent>
    </ResponsiveContainer>
  );
}

type CustomGraphProps = {
  input: CustomGraphInput;
  titleProps?: GraphTitleProps;
  hideGroupLabel?: boolean;
  load?: boolean;
  size?: "sm" | "md";
  filters?: Record<FilterField, string[] | Record<string, string[]>>;
  onDataPointClick?: DataPointClick;
  emptyState?: React.ReactNode;
};

const CustomGraph_ = React.memo(
  function CustomGraph({
    input,
    titleProps,
    hideGroupLabel = false,
    load = true,
    size,
    filters,
    onDataPointClick,
    emptyState,
  }: CustomGraphProps) {
    const height_ = input.height ?? 300;
    const { daysDifference } = useAnalyticsPeriod();
    const project = useAnalyticsHost().project();
    const { hiddenSeries, toggleSeries } = useSeriesVisibility(
      `${project?.id ?? ""}:${input.graphId}`,
    );
    // Unique prefix for SVG gradient ids to avoid collisions across charts
    const uniqueId = useId();
    const handleDataPointClick = useDataPointClick({ input, onDataPointClick });
    // Compensations the stored graph JSON does not carry, shared with the scheduled-report
    // renderer so a panel on screen is not blank in a report email (#6716).
    const timeScale = useMemo(
      () =>
        resolveGraphTimeScale({
          graphType: input.graphType,
          timeScale: input.timeScale,
          daysDifference,
        }),
      [input.graphType, input.timeScale, daysDifference],
    );
    const queryInput = useMemo(() => withGroupedPipeline(input), [input]);
    const { timeseries, monitorSummaryTimeseries, filterParams, freshness } = useGraphTimeseries({
      input,
      queryInput,
      timeScale,
      filters,
      load,
    });
    // The query that was sent, not the input, so the keys match its answer.
    const graphRows = graphRowsOf({ input, queryInput, timeseries });
    const { seriesByKey, nameForSeries } = useSeriesNaming({ input, queryInput, hideGroupLabel });
    const pieData = usePieData({ input, seriesByKey, timeseries, nameForSeries });
    const palette = useChartPalette();
    const colorForSeries = colorForSeriesOf({ seriesByKey, getColor: palette.getColor });
    const yAxisValueFormat = yAxisValueFormatOf(input.series);
    const formatDate = (date: string) => formatChartDate({ date, timeScale, daysDifference });
    const tooltipValueFormatter = tooltipFormatterOf({ seriesByKey, formatDate });
    const chartKey = graphRows.filledRows ? input.graphId : "loading";
    const context: SeriesContext = {
      input,
      uniqueId,
      hiddenSeries,
      seriesByKey,
      colorForSeries,
      nameForSeries,
      onDataPointClick,
      timeScale,
    };

    const graph = (() => {
      if (input.graphType === "summary") {
        return (
          <SummaryGraph
            input={input}
            seriesByKey={seriesByKey}
            timeseries={timeseries}
            nameForSeries={nameForSeries}
            titleProps={titleProps}
          />
        );
      }
      if (input.graphType === "pie" || input.graphType === "donnut") {
        return (
          <PieGraph
            input={input}
            pieData={pieData}
            chartKey={chartKey}
            height_={height_}
            seriesByKey={seriesByKey}
            handleDataPointClick={handleDataPointClick}
            colorForSeries={colorForSeries}
            tooltipValueFormatter={tooltipValueFormatter}
          />
        );
      }
      if (
        (input.graphType === "bar" || input.graphType === "horizontal_bar") &&
        input.timeScale === "full"
      ) {
        const [XAxisComponent, YAxisComponent] = axesFor(input.graphType);
        return (
          <SummaryBarGraph
            input={input}
            seriesByKey={seriesByKey}
            timeseries={timeseries}
            nameForSeries={nameForSeries}
            chartKey={chartKey}
            height_={height_}
            gray400={palette.gray400}
            yAxisValueFormat={yAxisValueFormat}
            tooltipValueFormatter={tooltipValueFormatter}
            cursorColor={palette.cursorColor}
            handleDataPointClick={handleDataPointClick}
            colorForSeries={colorForSeries}
            XAxisComponent={XAxisComponent}
            YAxisComponent={YAxisComponent}
          />
        );
      }
      if (input.graphType === "monitor_graph") {
        return (
          <MonitorGraph
            input={input}
            seriesByKey={seriesByKey}
            currentAndPreviousData={graphRows.rows}
            currentAndPreviousDataFilled={graphRows.filledRows}
            summaryTimeseries={monitorSummaryTimeseries}
            sortedKeys={graphRows.sortedKeys}
            nameForSeries={nameForSeries}
            getColor={palette.getColor}
            size={size}
            filterParams={filterParams}
            height_={height_}
            formatWith={formatWith}
            yAxisValueFormat={yAxisValueFormat}
            formatDate={formatDate}
          />
        );
      }
      return (
        <CartesianGraph
          context={context}
          rows={graphRows.filledRows}
          sortedKeys={graphRows.sortedKeys}
          maxValue={graphRows.maxValue}
          yAxisValueFormat={yAxisValueFormat}
          palette={palette}
          formatDate={formatDate}
          tooltipValueFormatter={tooltipValueFormatter}
          toggleSeries={toggleSeries}
          chartKey={chartKey}
          height_={height_}
        />
      );
    })();

    return (
      <CachedView
        asOf={freshness.asOf}
        confirmed={freshness.confirmed}
        failed={Boolean(timeseries.error) && !timeseries.isFetching}
      >
        <GraphContainer
          graphType={input.graphType}
          timeseries={timeseries}
          isEmpty={graphIsEmpty({
            graphType: input.graphType,
            timeseries,
            allValues: graphRows.allValues,
            rows: graphRows.rows,
          })}
          height_={height_}
          emptyState={emptyState}
        >
          {graph}
        </GraphContainer>
      </CachedView>
    );
  },
  (prevProps, nextProps) => {
    return (
      JSON.stringify(prevProps.input) === JSON.stringify(nextProps.input) &&
      JSON.stringify(prevProps.titleProps) === JSON.stringify(nextProps.titleProps) &&
      JSON.stringify(prevProps.filters) === JSON.stringify(nextProps.filters) &&
      prevProps.onDataPointClick === nextProps.onDataPointClick
    );
  },
);

const RADIAN = Math.PI / 180;
const pieChartPercentageLabel = (props: PieLabelRenderProps) => {
  const innerRadius = Number(props.innerRadius);
  const radius = innerRadius + (Number(props.outerRadius) - innerRadius) * 0.5;
  const midAngle = Number(props.midAngle ?? 0);
  const x = Number(props.cx) + radius * Math.cos(-midAngle * RADIAN);
  const y = Number(props.cy) + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central">
      {`${(Number(props.percent ?? 0) * 100).toFixed(0)}%`}
    </text>
  );
};

const getSeries = (seriesByKey: Record<string, Series>, aggKey: string) => {
  let groupKey: string | undefined;
  let seriesKey = aggKey;

  const parts = aggKey.split(">");
  if (parts.length === 2) {
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

const shapeDataForGraph = (input: CustomGraphInput, timeseries: TimeseriesQuery) => {
  const flattenCurrentPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.currentPeriod);
  const flattenPreviousPeriod =
    timeseries.data && flattenGroupData(input, timeseries.data.previousPeriod);

  const currentAndPreviousData = flattenCurrentPeriod?.map((entry, index) => {
    if (!flattenPreviousPeriod) return entry;
    return {
      ...entry,
      ...Object.fromEntries(
        Object.entries(flattenPreviousPeriod[index] ?? {}).map(([key, value]) => [
          `previous>${key}`,
          value ?? 0,
        ]),
      ),
    };
  });

  return currentAndPreviousData;
};

const shapeDataForSummary = ({
  input,
  seriesByKey,
  timeseries,
  nameForSeries,
}: {
  input: CustomGraphInput;
  seriesByKey: Record<string, Series>;
  timeseries: TimeseriesQuery;
  nameForSeries: (aggKey: string) => string;
}) => {
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

      // The resolver owns the precedence (percentage over cardinality over the metric's own
      // format), so summary totals never disagree with the axis and tooltip paths.
      const formatOverride = metric
        ? {
            ...metric,
            format:
              resolveSeriesValueFormat({
                isPercent: series?.asPercent,
                aggregation: series?.aggregation,
                metricFormat: metric.format,
              }) ?? metric.format,
          }
        : metric;

      const directedMetric = series?.increaseIs
        ? { ...formatOverride, increaseIs: series.increaseIs }
        : formatOverride;

      return {
        key: aggKey,
        name: nameForSeries(aggKey),
        metric: formatOverride ? directedMetric : undefined,
        value: totalValue,
        noDataUrl: series?.noDataUrl,
      };
    });
  };

  return {
    current: reduceToSummary(collectedCurrent),
    previous: reduceToSummary(collectedPrevious),
  };
};

const collectAllDays = (data: GraphRow[]) => {
  const result: Record<string, number[]> = {};

  for (const entry of data) {
    for (const key of Object.keys(entry)) {
      if (key === "date") continue;
      if (!result[key]) {
        result[key] = [];
      }
      const value = entry[key];
      result[key]?.push(typeof value === "number" ? value : 0);
    }
  }

  return result;
};

/** A charted value, or NaN where a gap was kept, so sums and extents skip it. */
function chartedValue(value: number | string | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

/** The per-group buckets a grouped series answers with, when the entry carries any. */
function groupBucketsOf(
  value: TimeseriesBucket[string] | undefined,
): Record<string, Record<string, number>> {
  return typeof value === "object" && value !== null ? value : {};
}

/** An ungrouped bucket's series values; only a grouped series answers with nested buckets. */
function ungroupedRow(entry: TimeseriesBucket): GraphRow {
  const values = Object.entries(entry).flatMap(([key, value]) =>
    typeof value === "number" || typeof value === "string" ? [[key, value] as const] : [],
  );
  return { ...Object.fromEntries(values), date: entry.date };
}

const flattenGroupData = (
  input: CustomGraphInput,
  data: NonNullable<TimeseriesQuery["data"]>["currentPeriod"],
): GraphRow[] => {
  const groupBy = input.groupBy;
  if (!groupBy) return data.map(ungroupedRow);

  return data.map((entry) => {
    const buckets = groupBucketsOf(entry[groupBy]);
    const aggregations = Object.fromEntries(
      Object.entries(buckets)
        .filter(([bucketKey]) => !(input.excludeUnknownBuckets && bucketKey === "unknown"))
        .flatMap(([bucketKey, bucket]) =>
          Object.entries(bucket).map(([metricKey, metricValue]) => [
            `${bucketKey}>${metricKey}`,
            metricValue ?? 0,
          ]),
        ),
    );
    return { ...aggregations, date: entry.date };
  });
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
      if (filledEntry[previousKey] === null || filledEntry[previousKey] === undefined) {
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
  summaryTimeseries,
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
  summaryTimeseries: TimeseriesQuery;
  sortedKeys: string[];
  nameForSeries: (aggKey: string) => string;
  getColor: (colorSet: RotatingColorSet, index: number, opacity: number) => string;
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
  const { isPassRate, summaryValue, hasData, hasLoaded, colorSet, scoreLabel, maxValue } =
    summarizeMonitor({
      seriesKey: firstKey,
      data: currentAndPreviousData,
      filledData: currentAndPreviousDataFilled,
      summary: summaryTimeseries,
      disabled: !!input.monitorGraph?.disabled,
    });
  const gray400 = useColorRawValue("gray.400");

  // Color adjustments for light/dark mode
  // Light mode: light backgrounds, dark text
  // Dark mode: dark backgrounds, light text
  const bgAdjustment = useColorModeValue(-400, 200);
  const textAdjustment = useColorModeValue(300, -300);
  const areaAdjustment = useColorModeValue(-300, 100);

  // Glow effect for dark mode based on colorSet
  const glowColor = getColor(colorSet, 0, 0);
  const boxShadow = useColorModeValue("none", `0 0 20px ${glowColor}40, 0 0 40px ${glowColor}20`);

  return (
    <Box
      width="full"
      height="full"
      position="relative"
      border="1px solid"
      borderColor="border"
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
            <Badge colorPalette="blue" variant="solid" size="sm" marginTop="-3px">
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
            {!hasLoaded && <Skeleton width="56px" height="36px" />}
            {hasLoaded && !hasData && "-"}
            {hasLoaded && hasData && numeral(summaryValue).format(isPassRate ? "0%" : "0.[00]")}
          </Text>
          <Text fontSize="xs">{hasData ? scoreLabel : "No data yet"}</Text>
        </HStack>
        <Text fontSize="xs">
          {filterParams.startDate &&
            filterParams.endDate &&
            monitorPeriodLabel({
              startDate: filterParams.startDate,
              endDate: filterParams.endDate,
              now: nowInstant().epochMilliseconds,
            })}
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
                style={{ fontSize: "11px" }}
              />
              <YAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickMargin={20}
                domain={[0, maxValue]}
                tick={{ fill: gray400 }}
                style={{ fontSize: "11px" }}
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
                ["stacked_bar", "stacked_area"].includes(input.graphType) ? "same" : undefined
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

/** A bar per group over the whole period, largest first; clicking one drills into it. */
function SummaryBarGraph({
  input,
  seriesByKey,
  timeseries,
  nameForSeries,
  chartKey,
  height_,
  gray400,
  yAxisValueFormat,
  tooltipValueFormatter,
  cursorColor,
  handleDataPointClick,
  colorForSeries,
  XAxisComponent,
  YAxisComponent,
}: {
  input: CustomGraphInput;
  seriesByKey: Record<string, Series>;
  timeseries: TimeseriesQuery;
  nameForSeries: (aggKey: string) => string;
  chartKey: string;
  height_: number;
  gray400: string;
  yAxisValueFormat: string | ((value: number) => string) | undefined;
  tooltipValueFormatter: Formatter<ValueType, NameType>;
  cursorColor: string;
  handleDataPointClick: Parameters<typeof CustomGraph>[0]["onDataPointClick"];
  colorForSeries: (aggKey: string, index: number) => string;
  XAxisComponent: typeof XAxis;
  YAxisComponent: typeof YAxis;
}) {
  const summaryData = shapeDataForSummary({ input, seriesByKey, timeseries, nameForSeries });
  const sortedCurrentData = [...(summaryData.current ?? [])].toSorted((a, b) => b.value - a.value);

  const longestName = Math.max(0, ...summaryData.current.map((entry) => entry.name.length));

  const xAxisWidth = Math.min(longestName * 8, 300);

  return (
    <ResponsiveContainer key={chartKey} height={height_}>
      <BarChart
        data={sortedCurrentData}
        barCategoryGap={10}
        layout={input.graphType === "horizontal_bar" ? "vertical" : undefined}
      >
        <XAxisComponent
          type="category"
          dataKey="name"
          width={input.graphType === "horizontal_bar" ? xAxisWidth : undefined}
          height={input.graphType === "horizontal_bar" ? undefined : xAxisWidth}
          interval={input.graphType === "horizontal_bar" ? 0 : undefined}
          tickLine={false}
          axisLine={false}
          tick={{ fill: gray400 }}
          style={{ fontSize: "11px" }}
          angle={input.graphType === "horizontal_bar" ? undefined : 45}
          textAnchor={input.graphType === "horizontal_bar" ? "end" : "start"}
        />
        <YAxisComponent
          type="number"
          dataKey="value"
          domain={[0, (dataMax: number) => (dataMax > 0 ? dataMax : 1)]}
          tick={{ fill: gray400 }}
          style={{ fontSize: "11px" }}
          tickFormatter={(value: number) => {
            if (typeof yAxisValueFormat === "function") {
              return yAxisValueFormat(value);
            }
            return numeral(value).format(yAxisValueFormat);
          }}
        />
        <Tooltip
          content={<ChartTooltip />}
          formatter={tooltipValueFormatter}
          cursor={{ fill: cursorColor }}
          wrapperStyle={{ zIndex: 1000 }}
        />
        <Bar
          dataKey="value"
          minPointSize={4}
          onClick={(item) => {
            if (handleDataPointClick && item?.payload?.key) {
              const key = item.payload.key;
              const { series, groupKey } = getSeries(seriesByKey, key);
              // Derive evaluatorId from per-series metadata, falling back to groupByKey or
              // first series key
              const evaluatorId = series?.key || input.groupByKey || input.series[0]?.key;

              handleDataPointClick({
                evaluatorId,
                groupKey,
              });
            }
          }}
          style={{ cursor: handleDataPointClick ? "pointer" : "default" }}
        >
          {sortedCurrentData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={colorForSeries(entry.key, index)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
