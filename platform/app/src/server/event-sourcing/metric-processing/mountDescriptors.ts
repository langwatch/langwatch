/**
 * Mount facts for this pipeline's three projections (ADR-106).
 *
 * TODO(package gap): `@langwatch/event-sourcing`'s `validateMount`/`Mount`
 * types are not yet part of the package's public surface —
 * `package.json`'s `exports` map resolves only `.`, and
 * `mount/validateMount.ts` is not re-exported from `index.ts` — so this
 * pipeline cannot literally call the checker. `MetricProjectionMount` below
 * is a deliberately narrow, temporary stand-in: it is NOT a parallel
 * reimplementation of `Mount`/`MountShape` (it has one shape, `map` +
 * `partition` + `batch`, because that is the only shape this pipeline ever
 * needs), and it should be deleted in favour of the real `Mount` type the
 * moment the package exports it. The two rules that matter for an
 * all-`map`, no-`fold` pipeline are checked directly against these
 * constants in `__tests__/groupKeysAndMounts.unit.test.ts`, so a future
 * composition root (or the checker, once exported) has an unambiguous
 * answer to hand it. See the final report for this as a flagged package gap.
 *
 * **`store` here is a fact about the ClickHouse table's merge strategy
 * (ADR-099), not about which `@langwatch/event-sourcing` TS store interface a
 * projection uses at runtime.** `createMapExecutor` only accepts
 * `AppendStore | MergeStore` — there is no map-shaped "batch write into a
 * `ReplacingMergeTree`" interface yet, so `metricSeriesCatalog` and
 * `metricTimeRollup` both run on an `AppendStore` even though their
 * *table's* merge strategy is `replacing` (`metric_series`,
 * `metric_time_rollups`; migration `00049_create_canonical_metrics.sql`). A
 * map never reads its store back regardless of the table's engine, so this
 * is safe — but it is exactly the seam the `store` field below documents,
 * because nothing else records it.
 */

export type MetricStoreKind = "append" | "replace";

export interface MetricProjectionMount {
  readonly projection: "map";
  readonly store: MetricStoreKind;
  readonly scope: "partition";
  readonly collapse: "batch";
}

/**
 * `metric_data_points`: PointId is content-addressed and part of the sort
 * key, so a "collision" is always the same content arriving twice —
 * `ReplacingMergeTree` with a per-record identity, which ADR-099 classifies
 * as `append` even though the physical engine is `ReplacingMergeTree`.
 */
export const METRIC_DATA_POINT_STORAGE_MOUNT: MetricProjectionMount = {
  projection: "map",
  store: "append",
  scope: "partition",
  collapse: "batch",
};

/**
 * `metric_series`: dedup key is `(TenantId, SeriesId)`, and two writes for
 * the same series can carry genuinely different content (attributes,
 * description) — `LastSeenAt` picks a winner between competing versions,
 * which is `replace`, not `append`. (Also carried as known debt in ADR-099:
 * `metric_series` partitions, TTLs and versions all on the same moving
 * `LastSeenAt` column — a pre-existing property of the deployed table, not
 * introduced by this rewrite.)
 */
export const METRIC_SERIES_CATALOG_MOUNT: MetricProjectionMount = {
  projection: "map",
  store: "replace",
  scope: "partition",
  collapse: "batch",
};

/**
 * `metric_time_rollups`: each write recomputes a bucket's complete value from
 * the authoritative raw points and replaces the prior row outright — never an
 * accumulator the engine adds to. `UpdatedAt` orders competing full
 * recomputations of the same bucket. This is `replace`, and explicitly not
 * `merge`: nothing here writes with `async_insert`-style partial deltas that
 * an `AggregatingMergeTree` would need to combine (ADR-099/ADR-106 decision
 * 5 — `merge` is closed to new mounts).
 */
export const METRIC_TIME_ROLLUP_MOUNT: MetricProjectionMount = {
  projection: "map",
  store: "replace",
  scope: "partition",
  collapse: "batch",
};
