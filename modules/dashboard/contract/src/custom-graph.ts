/**
 * A chart-builder graph as a dashboard stores it: the chart's series in the analytics
 * vocabulary, how it draws, and the colour set each series takes.
 */
import {
  analyticsChartGroupSchema,
  analyticsChartSeriesSchema,
  filterFieldsEnum,
} from "@langwatch/analytics-contract";
import { z } from "zod";

/** The colour sets a series may draw in; the design system holds the colours themselves. */
export const chartColorSetSchema = z.enum([
  "colors",
  "positiveNegativeNeutral",
  "orangeTones",
  "blueTones",
  "greenTones",
  "purpleTones",
  "yellowTones",
  "tealTones",
  "cyanTones",
  "pinkTones",
  "grayTones",
  "redTones",
]);
export type ChartColorSet = z.infer<typeof chartColorSetSchema>;

export const customGraphSeriesSchema = z.object({
  ...analyticsChartSeriesSchema.shape,
  name: z.string(),
  colorSet: chartColorSetSchema,
  increaseIs: z.optional(z.enum(["good", "bad", "neutral"])),
  noDataUrl: z.optional(z.string()),
});
export type CustomGraphSeries = z.infer<typeof customGraphSeriesSchema>;

export const customGraphTypeSchema = z.enum([
  "line",
  "bar",
  "horizontal_bar",
  "stacked_bar",
  "area",
  "stacked_area",
  "scatter",
  "pie",
  "donnut",
  "summary",
  "monitor_graph",
]);

export const customGraphFiltersSchema = z.partialRecord(
  filterFieldsEnum,
  z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]),
);

export const customGraphInputSchema = z.object({
  startDate: z.optional(z.number()),
  endDate: z.optional(z.number()),
  graphId: z.string(),
  filters: z.optional(customGraphFiltersSchema),
  /** Trace origins the graph leaves out, whatever filters the page carries. */
  excludeOrigins: z.optional(z.array(z.string())),
  graphType: customGraphTypeSchema,
  series: z.array(customGraphSeriesSchema),
  groupBy: z.optional(analyticsChartGroupSchema),
  groupByKey: z.optional(z.string()),
  includePrevious: z.boolean(),
  timeScale: z.union([z.literal("full"), z.number()]),
  connected: z.optional(z.boolean()),
  height: z.optional(z.number()),
  excludeUnknownBuckets: z.optional(z.boolean()),
  monitorGraph: z.optional(
    z.object({
      disabled: z.optional(z.boolean()),
      isGuardrail: z.optional(z.boolean()),
    }),
  ),
});
export type CustomGraphInput = z.infer<typeof customGraphInputSchema>;
