/**
 * Compensations applied before a stored `CustomGraphInput` is queried, which its raw JSON
 * does not carry on its own: summary charts read "full", grouped pie/donut charts get a
 * default pipeline. The scheduled-report renderer applies the same pair (#6716).
 */
import type { CustomGraphInput } from "./custom-graph.ts";

/** Minutes per bucket at or above which a bucket is a whole day. */
const DAY_SCALE_MINUTES = 1440;

/** The hourly bucket a missing or mangled stored `timeScale` degrades to, never NaN. */
const FALLBACK_SCALE_MINUTES = 60;

function normalizeNumericTimeScale(value: unknown): number {
  const parsed = typeof value === "string" ? parseInt(value, 10) : value;
  const isUsable = typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0;
  return isUsable ? parsed : FALLBACK_SCALE_MINUTES;
}

function storedGraphTimeScale({
  graphType,
  timeScale,
}: {
  graphType: CustomGraphInput["graphType"];
  timeScale: CustomGraphInput["timeScale"];
}): CustomGraphInput["timeScale"] {
  if (graphType === "summary" || timeScale === "full") return "full";
  return normalizeNumericTimeScale(timeScale);
}

/**
 * The time scale to QUERY with. Summary charts read "full"; pie and donut keep a numeric
 * scale. A short window (`daysDifference` <= 2) reads a day-or-coarser bucket by the hour;
 * omit `daysDifference` to skip that downgrade.
 */
export function resolveGraphTimeScale({
  graphType,
  timeScale,
  daysDifference,
}: {
  graphType: CustomGraphInput["graphType"];
  timeScale: CustomGraphInput["timeScale"];
  daysDifference?: number;
}): CustomGraphInput["timeScale"] {
  const resolved = storedGraphTimeScale({ graphType, timeScale });

  if (
    typeof resolved === "number" &&
    resolved >= DAY_SCALE_MINUTES &&
    daysDifference !== undefined &&
    daysDifference <= 2
  ) {
    return FALLBACK_SCALE_MINUTES;
  }
  return resolved;
}

/**
 * Pie and donut charts grouped by a field need a pipeline to fill grouped buckets at all:
 * each series without one gets `sum` over `trace_id`; an author's own is never overwritten.
 */
export function withGroupedPipeline(input: CustomGraphInput): CustomGraphInput {
  const isGroupedRound =
    (input.graphType === "pie" || input.graphType === "donnut") && !!input.groupBy;

  if (!isGroupedRound || input.series.every((series) => series.pipeline)) {
    return input;
  }

  return {
    ...input,
    series: input.series.map((series) =>
      series.pipeline
        ? series
        : { ...series, pipeline: { field: "trace_id" as const, aggregation: "sum" as const } },
    ),
  };
}
