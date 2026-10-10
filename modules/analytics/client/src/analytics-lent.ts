/** Analytics UI lent by token to the screens that filter traces and chart them (§10.1). */

import type {
  AnalyticsChartGroup,
  AnalyticsChartSeries,
  FilterField,
} from "@langwatch/analytics-contract";
import { uiTokens } from "@langwatch/module";
import type { ReactNode } from "react";

/** What a screen hands analytics' filter sidebar; it reads the filters from the URL itself. */
export type FilterSidebarProps = { defaultShowFilters?: boolean; hideTopics?: boolean };

export const FilterSidebarToken =
  uiTokens("analytics").component<FilterSidebarProps>("filterSidebar");

/** dashboard's graph types, copied; analytics-browser's drift test pins them equal. */
export type CustomGraphType =
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

/** dashboard's chart colour sets, copied; analytics-browser's drift test pins them equal. */
export type CustomGraphColorSet =
  | "colors"
  | "positiveNegativeNeutral"
  | "orangeTones"
  | "blueTones"
  | "greenTones"
  | "purpleTones"
  | "yellowTones"
  | "tealTones"
  | "cyanTones"
  | "pinkTones"
  | "grayTones"
  | "redTones";

/** One series of a custom graph: an analytics series with its name and colour. */
export type CustomGraphSeries = AnalyticsChartSeries & {
  name: string;
  colorSet: CustomGraphColorSet;
  increaseIs?: "good" | "bad" | "neutral";
  noDataUrl?: string;
};

/** The graph to draw: dashboard's parsed custom graph input, restated for readers. */
export type CustomGraphInput = {
  startDate?: number;
  endDate?: number;
  graphId: string;
  filters?: Partial<Record<FilterField, string[] | Record<string, string[]>>>;
  excludeOrigins?: string[];
  graphType: CustomGraphType;
  series: CustomGraphSeries[];
  groupBy?: AnalyticsChartGroup;
  groupByKey?: string;
  includePrevious: boolean;
  timeScale: "full" | number;
  connected?: boolean;
  height?: number;
  excludeUnknownBuckets?: boolean;
  monitorGraph?: { disabled?: boolean; isGuardrail?: boolean };
};

/** The title styles a reader may set: a narrow slice of the design system's style object. */
export type CustomGraphTitleProps = { fontSize?: string; color?: string };

/** What a screen hands analytics' lent graph: the graph to draw, and what to show when empty. */
export type CustomGraphProps = {
  input: CustomGraphInput;
  titleProps?: CustomGraphTitleProps;
  emptyState?: ReactNode;
};

export const CustomGraphToken = uiTokens("analytics").component<CustomGraphProps>("customGraph");
