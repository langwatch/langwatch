import type { CustomGraphInput } from "~/components/analytics/CustomGraph";

/** Minutes per bucket at or above which a bucket is a whole day. */
const DAY_SCALE_MINUTES = 1440;

/** The hourly default a graph falls back to when its stored `timeScale` is
 *  missing or mangled — stored JSON reaches here cast, not parsed, so a bad
 *  value must degrade to a sane bucket rather than throw or query with NaN. */
const FALLBACK_SCALE_MINUTES = 60;

function normalizeNumericTimeScale(value: unknown): number {
  const parsed =
    typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : FALLBACK_SCALE_MINUTES;
}

/**
 * Two compensations the analytics UI applies before querying a graph's
 * stored `CustomGraphInput`, which the raw stored JSON does not carry on its
 * own: forcing "full" resolution for summary charts, and injecting a default
 * pipeline for grouped pie/donut charts. Without them the backend returns
 * empty buckets for exactly those panel types.
 *
 * `CustomGraph.tsx` (the live dashboard) and `report-chart.service.ts` (the
 * scheduled-report renderer, ADR-044) both draw a panel from the same stored
 * graph JSON, so both need the same compensation applied — otherwise a
 * summary/pie/donut panel renders on screen but comes back blank in the
 * scheduled email (#6716).
 */

/**
 * The time scale to actually QUERY with, given the graph's own configured
 * `timeScale`.
 *
 * Summary charts are forced to "full" — a summary aggregates the whole
 * window into one figure, and a numeric bucket size returns no rows for it.
 * Pie and donut charts are not forced to "full" — they keep a numeric
 * `timeScale` (grouped data comes via `withGroupedPipeline` instead), which
 * also means the short-window downgrade below applies to them.
 *
 * A short window (`daysDifference` <= 2) additionally downgrades a
 * day-or-coarser bucket to hourly, so a two-day report does not collapse to
 * one lonely daily bucket. Omit `daysDifference` to skip that downgrade.
 */
export function resolveGraphTimeScale({
  graphType,
  timeScale,
  daysDifference,
}: {
  graphType: CustomGraphInput["graphType"];
  timeScale: CustomGraphInput["timeScale"];
  /** Span, in days, of the window being queried. */
  daysDifference?: number;
}): CustomGraphInput["timeScale"] {
  const shouldUseFull = graphType === "summary";
  const resolved = shouldUseFull
    ? "full"
    : timeScale === "full"
      ? timeScale
      : normalizeNumericTimeScale(timeScale);

  if (
    typeof resolved === "number" &&
    resolved >= DAY_SCALE_MINUTES &&
    daysDifference !== undefined &&
    daysDifference <= 2
  ) {
    return 60;
  }

  return resolved;
}

/**
 * Pie and donut charts grouped by a field need a pipeline to populate
 * grouped buckets at all — a numeric `timeScale` with `groupBy` and no
 * pipeline comes back empty. Adds the same default pipeline (`sum` over
 * `trace_id`) that both callers — the dashboard UI and the scheduled-report
 * renderer — inject to each series that does not already define
 * one of its own; an author's explicit pipeline is never overwritten.
 */
export function withGroupedPipeline(input: CustomGraphInput): CustomGraphInput {
  const isGroupedRound =
    (input.graphType === "pie" || input.graphType === "donnut") &&
    !!input.groupBy;

  if (!isGroupedRound || input.series.every((series) => series.pipeline)) {
    return input;
  }

  return {
    ...input,
    series: input.series.map((series) =>
      series.pipeline
        ? series
        : {
            ...series,
            pipeline: {
              field: "trace_id" as const,
              aggregation: "sum" as const,
            },
          },
    ),
  };
}
