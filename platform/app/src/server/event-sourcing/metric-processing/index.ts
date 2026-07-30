/**
 * `metric-processing` — canonical OTLP metric ingestion (ADR-098, ADR-099,
 * ADR-100, ADR-105, ADR-106).
 *
 * A metric data point is immutable and content-addressed
 * (`canonical/buildPoint.ts`), so every point is its own aggregate of
 * exactly one event and every projection mounted on it is a `map`, never a
 * `fold` — there is no lifetime to accumulate (`aggregate.ts`).
 *
 * Three projections mount on the `dataPointReceived` event, all `map`s
 * (`mountDescriptors.ts` records each one's ADR-099 store kind):
 *
 * - `metricDataPointStorage` — the canonical row, straight append.
 * - `metricSeriesCatalog` — per-series metadata, deduped by `LastSeenAt`.
 * - `metricTimeRollup` — 30-second buckets, recomputed whole from the
 *   authoritative raw points on every write (`rollup/buildRollups.ts`), never
 *   an accumulator carried forward.
 *
 * This module is the pipeline layer only. It does not construct a store, a
 * repository, or a ClickHouse client — those cross the composition root as
 * injected `AppendStore` values (ADR-102 decision 6, ADR-105 decision 6), and
 * building them is out of this pipeline's directory.
 */

import type { AppendStore } from "@langwatch/event-sourcing";
import { createMetricDataPointStorageProjection } from "./projections/metricDataPointStorage";
import { createMetricSeriesCatalogProjection } from "./projections/metricSeriesCatalog";
import { createMetricTimeRollupProjection } from "./projections/metricTimeRollup";
import type { CanonicalMetricDataPoint } from "./schema";

export type { MetricDataPointReceivedEvent } from "./aggregate";
export { metric, metricAggregateId } from "./aggregate";
export type { PreparedMetricPoint } from "./canonical/buildPoint";
export { buildPoint } from "./canonical/buildPoint";
export type {
  PiiRedactionLevel,
  RedactionService,
} from "./canonical/redaction";
export {
  MAX_CANONICAL_METRIC_PAYLOAD_BYTES,
  METRIC_MAP_COALESCE_MAX_BATCH,
  METRIC_ROLLUP_INTERVAL_MS,
} from "./constants";
export { metricCommandGroupKey, metricMapGroupKey } from "./groupKeys";
export type {
  MetricProjectionMount,
  MetricStoreKind,
} from "./mountDescriptors";
export {
  METRIC_DATA_POINT_STORAGE_MOUNT,
  METRIC_SERIES_CATALOG_MOUNT,
  METRIC_TIME_ROLLUP_MOUNT,
} from "./mountDescriptors";
export type { MetricPreparationResult } from "./prepareMetricDataPoints";
export { prepareMetricDataPoints } from "./prepareMetricDataPoints";
export type { MetricDataPointStorageDeps } from "./projections/metricDataPointStorage";
export {
  createMetricDataPointStorageProjection,
  METRIC_DATA_POINT_STORAGE_PROJECTION,
  metricDataPointStorageGroupKey,
} from "./projections/metricDataPointStorage";
export type { MetricSeriesCatalogDeps } from "./projections/metricSeriesCatalog";
export {
  createMetricSeriesCatalogProjection,
  METRIC_SERIES_CATALOG_PROJECTION,
  metricSeriesCatalogGroupKey,
} from "./projections/metricSeriesCatalog";
export type { MetricTimeRollupDeps } from "./projections/metricTimeRollup";
export {
  createMetricTimeRollupProjection,
  METRIC_TIME_ROLLUP_PROJECTION,
  metricTimeRollupGroupKey,
} from "./projections/metricTimeRollup";
export {
  affectedRollupBuckets,
  buildMetricRollups,
} from "./rollup/buildRollups";
export type {
  AggregationTemporality,
  CanonicalMetricDataPoint,
  MetricKind,
  MetricRollupRow,
  MetricTraceCorrelation,
} from "./schema";
export {
  canonicalMetricDataPointSchema,
  metricKindSchema,
} from "./schema";
export {
  clampMetricShardCount,
  metricShardLabel,
  resolveMetricShardCount,
} from "./shards";

/**
 * Builds the three map executors from injected stores. This is the one
 * assembly step that genuinely belongs in the pipeline rather than at the
 * composition root — ADR-102 decision 5's rule is that a *repository*
 * crossing as an injected dependency is a composition-root concern, not that
 * every executor construction is.
 *
 * Every store here is an `AppendStore` in the `@langwatch/event-sourcing`
 * sense (batch write, no read-back) regardless of its table's ADR-099 merge
 * strategy — see `mountDescriptors.ts` for why that is safe and still worth
 * declaring per projection.
 */
export function createMetricProcessingProjections(deps: MetricProcessingDeps) {
  return {
    metricDataPointStorage: createMetricDataPointStorageProjection({
      store: deps.metricDataPointStore,
    }),
    metricSeriesCatalog: createMetricSeriesCatalogProjection({
      store: deps.metricSeriesCatalogStore,
    }),
    metricTimeRollup: createMetricTimeRollupProjection({
      store: deps.metricTimeRollupStore,
    }),
  };
}

export interface MetricProcessingDeps {
  readonly metricDataPointStore: AppendStore<CanonicalMetricDataPoint>;
  readonly metricSeriesCatalogStore: AppendStore<CanonicalMetricDataPoint>;
  readonly metricTimeRollupStore: AppendStore<CanonicalMetricDataPoint>;
  /** Lane count every `partition` scope in this pipeline shards across. */
  readonly shardCount: number;
}
