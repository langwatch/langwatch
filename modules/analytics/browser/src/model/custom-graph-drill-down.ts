/**
 * Pure decisions behind a custom graph: its time scale, which charts drill into the Trace
 * Explorer on their own, where that drill-down points, and what a clicked data point means.
 */
import { Temporal, toEpochMs } from "@langwatch/time";

import { availableFilters } from "./analytics-filter-catalogue.ts";
import { buildMetadataFilterParams } from "./metadata-filter-params.ts";

/** What a clicked data point hands to whoever handles the click. */
export type DataPointClickParams = {
  evaluatorId?: string;
  groupKey?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
};

const BAR_GRAPH_TYPES: readonly string[] = ["bar", "stacked_bar", "horizontal_bar"];
const MS_PER_MINUTE = 60 * 1000;

/** Colour slots of the positive/negative/neutral set, by the outcome a group names. */
const OUTCOME_COLOR_INDEX: Readonly<Record<string, number>> = {
  positive: 0,
  negative: 1,
  neutral: 2,
  error: 1,
  failed: 1,
  succeeded: 0,
  skipped: 2,
  processed: 0,
  passed: 0,
  "with error": 1,
  "without error": 0,
};

export function isBarGraph(graphType: string): boolean {
  return BAR_GRAPH_TYPES.includes(graphType);
}

/** Pie, donut and summary-bar charts drill into the Trace Explorer when nobody else handles it. */
export function drillsDownByDefault({
  graphType,
  timeScale,
}: {
  graphType: string;
  timeScale: "full" | number;
}): boolean {
  const isCircular = graphType === "pie" || graphType === "donnut";
  const isSummaryBar =
    (graphType === "bar" || graphType === "horizontal_bar") && timeScale === "full";
  return isCircular || isSummaryBar;
}

function isoOf(value: string | number): string {
  return typeof value === "number"
    ? Temporal.Instant.fromEpochMilliseconds(value).toString({ fractionalSecondDigits: 3 })
    : value;
}

/** The trace-explorer parameter one group of a grouped chart narrows to. */
function groupFilterParams({
  groupBy,
  groupKey,
}: {
  groupBy: string;
  groupKey: string;
}): Record<string, string | string[]> {
  if (groupBy === "metadata.model") return { model: groupKey };
  if (groupBy.startsWith("metadata.")) {
    return { ...buildMetadataFilterParams(groupBy.replace("metadata.", ""), groupKey, groupKey) };
  }
  const filter = Object.entries(availableFilters).find(([field]) => field === groupBy)?.[1];
  return { [filter ? filter.urlKey : groupBy]: groupKey };
}

/** The Trace Explorer query a clicked group drills into, with the active range when given. */
export function drillDownQuery({
  groupBy,
  groupKey,
  startDate,
  endDate,
}: {
  groupBy: string;
  groupKey: string;
  startDate?: string | number;
  endDate?: string | number;
}): Record<string, string | string[]> {
  const query = groupFilterParams({ groupBy, groupKey });
  if (startDate != null) query.startDate = isoOf(startDate);
  if (endDate != null) query.endDate = isoOf(endDate);
  return query;
}

/** The colour slot a series takes: its outcome for an outcome-coloured group, else its place. */
export function seriesColorIndex({
  colorSet,
  groupKey,
  index,
}: {
  colorSet: string;
  groupKey: string | undefined;
  index: number;
}): number {
  if (colorSet === "positiveNegativeNeutral" && groupKey) {
    return OUTCOME_COLOR_INDEX[groupKey] ?? OUTCOME_COLOR_INDEX.neutral ?? 2;
  }
  return index;
}

function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.entries(value).find(([name]) => name === key)?.[1];
}

function dateOf(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/** The date a clicked point sits on; a bar reports it in more places than a line does. */
export function clickedDate({
  data,
  graphType,
}: {
  data: unknown;
  graphType: string;
}): string | undefined {
  const ownDate = dateOf(fieldOf(data, "date"));
  const payloadDate = dateOf(fieldOf(fieldOf(data, "payload"), "date"));
  if (!isBarGraph(graphType)) return ownDate ?? payloadDate;
  const active = fieldOf(data, "activePayload");
  const activeDate = Array.isArray(active)
    ? dateOf(fieldOf(fieldOf(active[0], "payload"), "date"))
    : undefined;
  return payloadDate ?? ownDate ?? activeDate;
}

/** The bucket a clicked bar covers, from its date to one time-scale later. */
export function clickedBucketRange({
  date,
  graphType,
  timeScale,
}: {
  date: string | undefined;
  graphType: string;
  timeScale: "full" | number;
}): { startDate: string | undefined; endDate: string | undefined } {
  if (!date || !isBarGraph(graphType) || typeof timeScale !== "number") {
    return { startDate: undefined, endDate: undefined };
  }
  const clickedMs = toEpochMs(date);
  return {
    startDate: isoOf(clickedMs),
    endDate: isoOf(clickedMs + timeScale * MS_PER_MINUTE),
  };
}
