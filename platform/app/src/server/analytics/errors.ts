import { HandledError } from "@langwatch/handled-error";

/**
 * Raised when a graph series asks for percentage mode on a measurement the
 * query builder cannot express as "filtered over unfiltered" in one pass.
 *
 * Percentage mode divides a series by the same measurement taken without that
 * series' own filters. For a plain aggregation both halves are two aggregates
 * over one scan. For a per-entity measurement (average per user, sum per
 * thread) the filter also decides which entities exist at all, so the two
 * halves are two different scans and cannot be divided bucket by bucket
 * without changing what the number means.
 *
 * The author can act on it — drop the percentage toggle, or drop the per-entity
 * breakdown — so it is handled rather than a silent wrong number. `fault`
 * stays the default (`customer`): the combination came from the graph the
 * author saved.
 *
 * It carries no `meta`. The metric that triggered it used to ride along, but
 * nothing read it: the presentation copy cannot name an internal metric key at
 * a customer, and the one caller that genuinely needs to know which series is
 * at fault — the graph-trigger evaluator — already has the series in its own
 * scope and logs it there.
 */
export class SeriesPercentageUnsupportedError extends HandledError {
  declare readonly code: "analytics_series_percentage_unsupported";

  constructor() {
    super(
      "analytics_series_percentage_unsupported",
      "This series cannot be shown as a percentage.",
      { httpStatus: 400 },
    );
    this.name = "SeriesPercentageUnsupportedError";
  }
}

/**
 * Is this the "percentage on a per-entity series" refusal, after it may have
 * crossed a worker or serialisation boundary?
 *
 * Matched on `code`, not `instanceof`: a background evaluator can receive this
 * error re-hydrated from a payload, where the prototype is gone but the code
 * survives.
 */
export function isSeriesPercentageUnsupported(error: unknown): boolean {
  return (
    (error as { code?: unknown } | null)?.code ===
    "analytics_series_percentage_unsupported"
  );
}
