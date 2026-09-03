/**
 * Explicit histogram bucket boundaries, by instrument name.
 *
 * OpenTelemetry configures bucket boundaries on the MeterProvider through a
 * View, not on the instrument — and the provider is constructed at boot, long
 * before any module that declares an instrument is evaluated. So the
 * boundaries cannot live at the declaration site the way prom-client's
 * `buckets` did. They live here, and boot reads this map to build one View per
 * histogram (see `metricHistogramViews`).
 *
 * A histogram with no entry here is a programming error, not a default:
 * `histogram()` throws on declaration rather than letting the instrument fall
 * back to OTel's generic boundaries (0…10000), which would silently produce
 * wrong `histogram_quantile` results for anything measured in bytes, spans or
 * multi-minute durations.
 *
 * The names are the Prometheus names these metrics have always had, preserved
 * byte-for-byte so existing dashboards and alerts keep working across the
 * transport change. See `docs/langwatch-dashboard.json`, which reads
 * `payload_size_bytes_bucket`, `trace_span_count_bucket`,
 * `evaluation_duration_milliseconds_bucket`,
 * `job_processing_duration_milliseconds_bucket`,
 * `collector_index_delay_milliseconds_*` and `http_request_duration_seconds_*`
 * directly.
 */

/** Milliseconds, sub-second work: cache reads, small writes. */
const SUB_SECOND_MS = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500] as const;

/** Milliseconds, the default event-sourcing execution profile. */
const EVENTING_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;

/** Milliseconds, event-sourcing work that is allowed to take half a minute. */
const EVENTING_SLOW_MS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000,
] as const;

/** Milliseconds, background jobs and evaluations measured in minutes. */
const JOB_MS = [
  10, 100, 300, 500, 700, 1_000, 2_500, 5_000, 7_500, 10_000, 15_000, 20_000, 30_000, 45_000,
  60_000, 90_000, 120_000,
] as const;

export const HISTOGRAM_BOUNDARIES: Readonly<Record<string, readonly number[]>> = {
  // --- process ---
  event_loop_lag_milliseconds: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000],

  // --- ingestion ---
  payload_size_bytes: [
    128, 256, 512, 768, 1_024, 4_096, 16_384, 65_536, 131_072, 262_144, 524_288, 1_048_576,
    2_097_152, 4_194_304, 8_388_608, 12_582_912, 16_777_216, 33_554_432, 67_108_864, 134_217_728,
  ],
  trace_span_count: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 175, 200,
  ],
  stored_object_size_bytes: [
    128, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216,
  ],

  // --- work ---
  job_processing_duration_milliseconds: JOB_MS,
  evaluation_duration_milliseconds: JOB_MS,
  topic_clustering_page_duration_milliseconds: [
    1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000,
  ],
  ingestion_pull_duration_milliseconds: [
    100, 250, 500, 1_000, 2_500, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  ],
  coding_agent_session_list_read_duration_milliseconds: EVENTING_SLOW_MS,

  // --- event sourcing ---
  event_sourcing_store_duration_milliseconds: EVENTING_MS,
  es_projection_duration_milliseconds: EVENTING_MS,
  es_command_duration_milliseconds: EVENTING_MS,
  es_subscriber_duration_milliseconds: EVENTING_MS,
  es_process_manager_duration_milliseconds: EVENTING_MS,
  es_process_outbox_duration_milliseconds: EVENTING_SLOW_MS,
  es_reactor_duration_milliseconds: EVENTING_SLOW_MS,
  // `es_fold_*` and `es_map_*` deliberately stop at 5s: a fold that takes
  // longer is a stall to alert on, not a latency to bucket.
  es_fold_projection_duration_milliseconds: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
  es_map_projection_duration_milliseconds: [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000],
  es_fold_cache_get_duration_milliseconds: SUB_SECOND_MS,
  es_fold_cache_store_duration_milliseconds: SUB_SECOND_MS,
  es_fold_cache_entry_bytes: [1_024, 8_192, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216],
  es_fold_blind_reapply_events: [1, 2, 5, 10, 25, 50, 100, 250, 500],
  // Wake lag is measured against a schedule that can be a day out, so the top
  // bucket is 24h. The duplicate declaration in `platform/app` capped this at
  // 1h; that one clobbered the package's at import time, which is why this map
  // now holds the single answer. See the decisions file, "one histogram, one
  // set of boundaries".
  es_process_wake_lag_milliseconds: [
    100, 1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000, 21_600_000,
    86_400_000,
  ],
  es_process_outbox_dispatch_lag_milliseconds: [
    50, 250, 1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000,
  ],

  // --- ClickHouse ---
  clickhouse_query_duration_seconds: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  clickhouse_statement_wait_seconds: [0.0005, 0.005, 0.025, 0.1, 0.5, 1, 5, 15, 60],

  // --- identity ---
  identity_commit_duration_seconds: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],

  // --- group queue ---
  gq_job_delay_milliseconds: [100, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000],
  gq_retry_attempt: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  gq_retry_backoff_milliseconds: [100, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000],
  gq_job_duration_milliseconds: [
    1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000,
  ],
};

/** One view descriptor per histogram, in a shape that needs no metrics SDK. */
export interface HistogramViewDescriptor {
  readonly instrumentName: string;
  readonly boundaries: readonly number[];
}

/**
 * The views a MeterProvider must be constructed with for histograms to keep
 * the boundaries above.
 *
 * Returns neutral data rather than the SDK's `ViewOptions` so this package
 * keeps depending only on `@opentelemetry/api`, never on
 * `@opentelemetry/sdk-metrics`. Each boot path maps it:
 *
 * ```ts
 * views: metricHistogramViews().map(({ instrumentName, boundaries }) => ({
 *   instrumentName,
 *   aggregation: {
 *     type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
 *     options: { boundaries: [...boundaries], recordMinMax: true },
 *   },
 * })),
 * ```
 */
export function metricHistogramViews(): HistogramViewDescriptor[] {
  return Object.entries(HISTOGRAM_BOUNDARIES).map(([instrumentName, boundaries]) => ({
    instrumentName,
    boundaries,
  }));
}
