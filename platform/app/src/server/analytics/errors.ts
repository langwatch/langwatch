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
 * author saved. The metric rides in `meta` so the composer can name the series
 * that has to change.
 */
export class SeriesPercentageUnsupportedError extends HandledError {
  declare readonly code: "analytics_series_percentage_unsupported";

  constructor(metric: string) {
    super(
      "analytics_series_percentage_unsupported",
      "This series cannot be shown as a percentage.",
      { httpStatus: 400, meta: { metric } },
    );
    this.name = "SeriesPercentageUnsupportedError";
  }
}
