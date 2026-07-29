/**
 * A graph trigger stores which series it watches as `actionParams.seriesName`,
 * formatted `"<index>/<key>/<aggregation>"` (e.g. `"1/evaluations.evaluation_score/avg"`).
 *
 * Only the leading index identifies the series; the key and aggregation are a
 * denormalised copy of the graph's own definition and can go stale. Everything
 * that needs the watched series must therefore resolve it by index against the
 * live graph, never by position 0.
 *
 * The cron (`pages/api/cron/triggers/customGraphTrigger.ts`), the event-sourced
 * evaluator, and the heartbeat's source classifier all parse this string, so it
 * lives here rather than being re-derived at each call site.
 */

/**
 * Parse the series index out of a `seriesName`.
 *
 * Returns `0` when `seriesName` is absent — matching the legacy default — and
 * `NaN` when the leading segment is not a number. Callers MUST bounds-check the
 * result against the graph's actual series array before indexing it.
 */
export function parseSeriesIndex(seriesName?: string | null): number {
  if (!seriesName) return 0;
  const [indexStr] = seriesName.split("/");
  return Number.parseInt(indexStr ?? "0", 10);
}
