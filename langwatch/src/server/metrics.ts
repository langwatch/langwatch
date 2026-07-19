import type { IncomingMessage } from "node:http";
import { performance } from "node:perf_hooks";
import {
  Counter,
  collectDefaultMetrics,
  Gauge,
  Histogram,
  register,
} from "prom-client";

// Enable default metrics collection (heap, stack, GC, etc.)
if (!register.getSingleMetric("process_cpu_user_seconds_total")) {
  collectDefaultMetrics({ register });
}

/**
 * Bearer-token gate shared by the web `/metrics` + `/workers/metrics` proxy
 * (start.ts) and the worker process's own `/metrics` listener (workers.ts), so
 * the two can't drift. Fail-closed in production when METRICS_API_KEY is unset;
 * in non-prod an unset key allows access for dev convenience.
 */
export const isMetricsAuthorized = (req: IncomingMessage): boolean => {
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === "production" && !process.env.METRICS_API_KEY) {
    throw new Error("METRICS_API_KEY is not set");
  }
  return (
    !process.env.METRICS_API_KEY ||
    authHeader === `Bearer ${process.env.METRICS_API_KEY}`
  );
};

/**
 * Collapses ID-shaped path segments to `{id}` so the `path` label on the HTTP
 * request histogram stays low-cardinality (route template, not raw URL).
 *
 * Every distinct label value is a permanent series in this process's registry
 * AND in Prometheus's head, held for the lifetime of the process. The
 * Next.js → Hono migration (#3170) dropped the route-template normalization
 * the original middleware had, so raw URLs — `/api/traces/trace_<nanoid>` and
 * friends — accumulate one series per entity ever requested and grow the
 * registry without bound. A path label must never contain per-entity IDs.
 */
export const normalizeMetricsPath = (path: string): string => {
  const segments = path.replace(/\/{2,}/g, "/").split("/");
  const normalized = segments.map((segment) => {
    if (segment === "") return segment;
    // percent-encoded leftovers (`abc%3D%3D`) are never route words
    if (segment.includes("%")) return "{id}";
    // purely numeric
    if (/^\d+$/.test(segment)) return "{id}";
    // uuid
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        segment,
      )
    )
      return "{id}";
    // bare hex ids (trace ids are 16/32 hex chars)
    if (/^[0-9a-f]{8,}$/i.test(segment)) return "{id}";
    // prefixed entity ids: trace_…, project_…, prompt_…, eval_… — the tail of
    // a generated id always carries a digit or uppercase, which route words
    // (`batch_clustering`) never do
    if (/^[a-z]+_[A-Za-z0-9_-]{6,}$/.test(segment) && /[A-Z0-9]/.test(segment))
      return "{id}";
    // long unprefixed tokens (nanoid, base64ish) — a digit or an uppercase
    // letter marks a generated token; route words are lowercase-only
    if (
      /^[A-Za-z0-9_-]{16,}$/.test(segment) &&
      (/\d/.test(segment) || /[A-Z]/.test(segment))
    )
      return "{id}";
    return segment;
  });
  return normalized.join("/") || "/";
};

type Endpoint =
  | "collector"
  | "log_steps"
  | "log_results"
  | "dataset"
  | "dataset_record"
  | "topic_clustering_batch"
  | "topic_clustering_incremental";

// Histogram for event loop lag
register.removeSingleMetric("event_loop_lag_milliseconds");
const eventLoopLag = new Histogram({
  name: "event_loop_lag_milliseconds",
  help: "Event loop lag in milliseconds",
  buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000],
});
setInterval(() => {
  const start = performance.now();
  setImmediate(() => {
    const lag = performance.now() - start;
    eventLoopLag.observe(lag);
  });
}, 500);

// Histogram for collector payload size (in bytes)
register.removeSingleMetric("payload_size_bytes");
const payloadSizeHistogram = new Histogram({
  name: "payload_size_bytes",
  help: "Size of payloads in bytes",
  labelNames: ["endpoint"] as const,
  buckets: [
    128, // 0.125 KB
    256, // 0.25 KB
    512, // 0.5 KB
    768, // 0.75 KB
    1024, // 1 KB
    4096, // 4 KB
    16384, // 16 KB
    65536, // 64 KB
    131072, // 128 KB
    262144, // 256 KB
    524288, // 512 KB
    1048576, // 1 MB
    2097152, // 2 MB
    4194304, // 4 MB
    8388608, // 8 MB
    12582912, // 12 MB
    16777216, // 16 MB
    33554432, // 32 MB
    67108864, // 64 MB
    134217728, // 128 MB
  ],
});

export const getPayloadSizeHistogram = (endpoint: Endpoint) =>
  payloadSizeHistogram.labels(endpoint);

// Histogram for number of spans in a trace
register.removeSingleMetric("trace_span_count");
export const traceSpanCountHistogram = new Histogram({
  name: "trace_span_count",
  help: "Number of spans in a trace",
  buckets: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 125,
    150, 175, 200,
  ],
});

type JobType =
  | "collector"
  | "collector_check_and_adjust"
  | "evaluations"
  | "track_events"
  | "topic_clustering"
  | "usage_stats"
  | "usage_reporting"
  | "event_sourcing"
  | "scenario"
  | "anomaly_detection"
  | "orphan_sweep_chain";

type JobStatus = "processing" | "completed" | "failed";

// Create a namespace for job processing counters
register.removeSingleMetric("job_processing_counter");
const jobProcessingCounter = new Counter({
  name: "job_processing_counter",
  help: "Total number of jobs processed by type and status",
  labelNames: ["job_type", "status"] as const,
});

export const getJobProcessingCounter = (jobType: JobType, status: JobStatus) =>
  jobProcessingCounter.labels(jobType, status);

// Histogram for job processing duration
register.removeSingleMetric("job_processing_duration_milliseconds");
export const jobProcessingDurationHistogram = new Histogram({
  name: "job_processing_duration_milliseconds",
  help: "Duration of jobs in milliseconds",
  labelNames: ["job_type"] as const,
  buckets: [
    10, 100, 300, 500, 700, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 30000,
    45000, 60000, 90000, 120000,
  ],
});

export const getJobProcessingDurationHistogram = (jobType: JobType) =>
  jobProcessingDurationHistogram.labels(jobType);

// Counter for worker restarts
register.removeSingleMetric("worker_restarts");
export const workerRestartsCounter = new Counter({
  name: "worker_restarts",
  help: "Number of times the worker has been restarted",
});

// ADR-022: edge-spool fail-open counter. The edge spool falls back to
// unmodified command data when the feature-flag store or S3 errors, so
// ingestion is never blocked. A healthy fleet emits this at ~zero rate;
// sustained increments (esp. reason="spool") indicate an S3 outage worth
// alerting on without grepping warn logs.
register.removeSingleMetric("langwatch_edge_spool_fail_open_total");
const edgeSpoolFailOpenCounter = new Counter({
  name: "langwatch_edge_spool_fail_open_total",
  help: "Count of ADR-022 edge-spool fail-open events by failing stage",
  labelNames: ["reason"] as const,
});

export const getEdgeSpoolFailOpenCounter = (reason: "flag_store" | "spool") =>
  edgeSpoolFailOpenCounter.labels(reason);

// Online-evaluator loop guard counter (post-2026-05-11 incident). A healthy
// fleet emits this at ~zero rate. Sustained increments indicate either
// causality_depth propagation is broken on the evaluator side or a customer
// has produced a loop the existing guards haven't anticipated.
//
// Per-tenant attribution intentionally lives in the structured log line
// next to each increment, NOT as a Prometheus label — adding tenant_id
// here would balloon series cardinality (one new series per tenant per
// reason, forever). Operators querying "which tenant is firing this?"
// use the log search; the Prometheus counter answers "is the fleet
// healthy overall?".
//
// labels.reason ∈ "depth_direct" (incoming span attr already >= 1)
//               | "parent_in_subtree" (parent span is in causal subtree)
register.removeSingleMetric("langwatch_evaluator_loop_blocked_total");
export const evaluatorLoopBlockedCounter = new Counter({
  name: "langwatch_evaluator_loop_blocked_total",
  help: "Number of online-evaluator dispatches blocked by the loop guards",
  labelNames: ["reason"] as const,
});

// Histogram for evaluation duration
register.removeSingleMetric("evaluation_duration_milliseconds");
export const evaluationDurationHistogram = new Histogram({
  name: "evaluation_duration_milliseconds",
  help: "Duration of evaluations in milliseconds",
  labelNames: ["evaluator_type"] as const,
  buckets: [
    10, 100, 300, 500, 700, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 30000,
    45000, 60000, 90000, 120000,
  ],
});

type EvaluationStatus = "processed" | "skipped" | "error";

register.removeSingleMetric("evaluation_status_counter");
const evaluationStatusCounter = new Counter({
  name: "evaluation_status_counter",
  help: "Count of evaluations status results",
  labelNames: ["evaluator_type", "status"] as const,
});

export const getEvaluationStatusCounter = (
  evaluatorType: string,
  status: EvaluationStatus,
) => evaluationStatusCounter.labels(evaluatorType, status);

// Counter for pii checks
register.removeSingleMetric("pii_checks");
export const piiChecksCounter = new Counter({
  name: "pii_checks",
  help: "Number of PII checks for the given method",
  labelNames: ["method"] as const,
});

export const getPiiChecksCounter = (method: string) =>
  piiChecksCounter.labels(method);

// ============================================================================
// Event Sourcing Metrics
// ============================================================================

// Counter for events stored (tracks throughput at event level, not job level)
register.removeSingleMetric("event_sourcing_events_stored_total");
const eventSourcingEventsStoredTotal = new Counter({
  name: "event_sourcing_events_stored_total",
  help: "Total number of events stored by event sourcing pipelines",
  labelNames: ["pipeline_name"] as const,
});

export const getEventSourcingEventsStoredCounter = (pipelineName: string) =>
  eventSourcingEventsStoredTotal.labels(pipelineName);

// Histogram for storeEvents duration (end-to-end: store + dispatch)
register.removeSingleMetric("event_sourcing_store_duration_milliseconds");
export const eventSourcingStoreDurationHistogram = new Histogram({
  name: "event_sourcing_store_duration_milliseconds",
  help: "Duration of storeEvents (store + projection dispatch) in milliseconds",
  labelNames: ["pipeline_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

// ============================================================================
// Event Sourcing Pipeline Metrics (command, fold, map, reactor)
// ============================================================================

type ESStatus = "completed" | "failed";
/** Reactors additionally skip pre-enqueue when shouldReact returns false. */
type ReactorStatus = ESStatus | "skipped";

// --- Unified projection metrics ---
// Keep the existing kind-specific metrics below for backwards compatibility,
// while giving dashboards one complete view across every projection lane.
register.removeSingleMetric("es_projection_total");
const esProjectionTotal = new Counter({
  name: "es_projection_total",
  help: "Total number of event-sourcing projection executions",
  labelNames: [
    "pipeline_name",
    "projection_kind",
    "projection_name",
    "status",
  ] as const,
});

export const incrementEsProjectionTotal = ({
  pipelineName,
  projectionKind,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionKind: "fold" | "map" | "state";
  projectionName: string;
  status: ESStatus;
}) =>
  esProjectionTotal
    .labels(pipelineName, projectionKind, projectionName, status)
    .inc();

register.removeSingleMetric("es_projection_duration_milliseconds");
const esProjectionDuration = new Histogram({
  name: "es_projection_duration_milliseconds",
  help: "Duration of event-sourcing projection execution in milliseconds",
  labelNames: ["pipeline_name", "projection_kind", "projection_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const observeEsProjectionDuration = ({
  pipelineName,
  projectionKind,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionKind: "fold" | "map" | "state";
  projectionName: string;
  durationMs: number;
}) =>
  esProjectionDuration
    .labels(pipelineName, projectionKind, projectionName)
    .observe(durationMs);

// --- Command metrics ---
register.removeSingleMetric("es_command_total");
const esCommandTotal = new Counter({
  name: "es_command_total",
  help: "Total number of commands processed",
  labelNames: ["pipeline_name", "command_type", "status"] as const,
});

export const incrementEsCommandTotal = (
  pipelineName: string,
  commandType: string,
  status: ESStatus,
) => esCommandTotal.labels(pipelineName, commandType, status).inc();

register.removeSingleMetric("es_command_duration_milliseconds");
const esCommandDuration = new Histogram({
  name: "es_command_duration_milliseconds",
  help: "Duration of command processing in milliseconds",
  labelNames: ["pipeline_name", "command_type"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const observeEsCommandDuration = (
  pipelineName: string,
  commandType: string,
  durationMs: number,
) => esCommandDuration.labels(pipelineName, commandType).observe(durationMs);

// --- Fold projection metrics ---
register.removeSingleMetric("es_fold_projection_total");
const esFoldProjectionTotal = new Counter({
  name: "es_fold_projection_total",
  help: "Total number of fold projection executions",
  labelNames: ["pipeline_name", "projection_name", "status"] as const,
});

export const incrementEsFoldProjectionTotal = ({
  pipelineName,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionName: string;
  status: ESStatus;
}) => {
  esFoldProjectionTotal.labels(pipelineName, projectionName, status).inc();
  incrementEsProjectionTotal({
    pipelineName,
    projectionKind: "fold",
    projectionName,
    status,
  });
};

register.removeSingleMetric("es_fold_projection_duration_milliseconds");
const esFoldProjectionDuration = new Histogram({
  name: "es_fold_projection_duration_milliseconds",
  help: "Duration of fold projection execution in milliseconds",
  labelNames: ["pipeline_name", "projection_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const observeEsFoldProjectionDuration = ({
  pipelineName,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionName: string;
  durationMs: number;
}) => {
  esFoldProjectionDuration
    .labels(pipelineName, projectionName)
    .observe(durationMs);
  observeEsProjectionDuration({
    pipelineName,
    projectionKind: "fold",
    projectionName,
    durationMs,
  });
};

register.removeSingleMetric("es_fold_refold_total");
const esFoldRefoldTotal = new Counter({
  name: "es_fold_refold_total",
  help: "Out-of-order fold re-folds, by whether the aggregate's history was replayed from the event log",
  labelNames: ["projection_name", "outcome"] as const,
});

/**
 * `performed` — the aggregate's full history was re-read and replayed.
 * `declined` — the projection set `refoldOnOutOfOrder: false`, so the batch was
 * applied on top instead (the events are never lost; only the replay is skipped).
 * `unavailable` — no eventLoader was wired, so a re-fold was impossible.
 */
export const incrementEsFoldRefoldTotal = (
  projectionName: string,
  outcome: "performed" | "declined" | "unavailable",
) => esFoldRefoldTotal.labels(projectionName, outcome).inc();

register.removeSingleMetric("es_reactor_collapsed_total");
const esReactorCollapsedTotal = new Counter({
  name: "es_reactor_collapsed_total",
  help: "Reactor dispatches skipped by collapsing a coalesced batch to one send per deduplication id",
  labelNames: ["pipeline_name", "reactor_name"] as const,
});

/**
 * Counts the sends a coalesced batch did NOT make. Each one would have
 * serialized, gzipped and blobbed `{event, foldState}` only for the queue's
 * dedup to discard it, so this is the direct measure of the churn the collapse
 * removes (2026-07-09 incident).
 */
export const incrementEsReactorCollapsedTotal = (
  pipelineName: string,
  reactorName: string,
  skipped: number,
) => esReactorCollapsedTotal.labels(pipelineName, reactorName).inc(skipped);

// --- Map projection metrics ---
register.removeSingleMetric("es_map_projection_total");
const esMapProjectionTotal = new Counter({
  name: "es_map_projection_total",
  help: "Total number of map projection executions",
  labelNames: ["pipeline_name", "projection_name", "status"] as const,
});

export const incrementEsMapProjectionTotal = ({
  pipelineName,
  projectionName,
  status,
}: {
  pipelineName: string;
  projectionName: string;
  status: ESStatus;
}) => {
  esMapProjectionTotal.labels(pipelineName, projectionName, status).inc();
  incrementEsProjectionTotal({
    pipelineName,
    projectionKind: "map",
    projectionName,
    status,
  });
};

register.removeSingleMetric("es_map_projection_duration_milliseconds");
const esMapProjectionDuration = new Histogram({
  name: "es_map_projection_duration_milliseconds",
  help: "Duration of map projection execution in milliseconds",
  labelNames: ["pipeline_name", "projection_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const observeEsMapProjectionDuration = ({
  pipelineName,
  projectionName,
  durationMs,
}: {
  pipelineName: string;
  projectionName: string;
  durationMs: number;
}) => {
  esMapProjectionDuration
    .labels(pipelineName, projectionName)
    .observe(durationMs);
  observeEsProjectionDuration({
    pipelineName,
    projectionKind: "map",
    projectionName,
    durationMs,
  });
};

// --- Reactor metrics ---
register.removeSingleMetric("es_reactor_total");
const esReactorTotal = new Counter({
  name: "es_reactor_total",
  help: "Total number of reactor executions",
  labelNames: ["pipeline_name", "reactor_name", "status"] as const,
});

export const incrementEsReactorTotal = (
  pipelineName: string,
  reactorName: string,
  status: ReactorStatus,
) => esReactorTotal.labels(pipelineName, reactorName, status).inc();

register.removeSingleMetric("es_reactor_duration_milliseconds");
const esReactorDuration = new Histogram({
  name: "es_reactor_duration_milliseconds",
  help: "Duration of reactor execution in milliseconds",
  labelNames: ["pipeline_name", "reactor_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const observeEsReactorDuration = (
  pipelineName: string,
  reactorName: string,
  durationMs: number,
) => esReactorDuration.labels(pipelineName, reactorName).observe(durationMs);

// --- Event subscriber metrics ---
register.removeSingleMetric("es_subscriber_total");
const esSubscriberTotal = new Counter({
  name: "es_subscriber_total",
  help: "Total number of event-sourcing subscriber executions",
  labelNames: ["pipeline_name", "subscriber_name", "status"] as const,
});

export const incrementEsSubscriberTotal = ({
  pipelineName,
  subscriberName,
  status,
}: {
  pipelineName: string;
  subscriberName: string;
  status: ESStatus;
}) => esSubscriberTotal.labels(pipelineName, subscriberName, status).inc();

register.removeSingleMetric("es_subscriber_duration_milliseconds");
const esSubscriberDuration = new Histogram({
  name: "es_subscriber_duration_milliseconds",
  help: "Duration of event-sourcing subscriber execution in milliseconds",
  labelNames: ["pipeline_name", "subscriber_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const observeEsSubscriberDuration = ({
  pipelineName,
  subscriberName,
  durationMs,
}: {
  pipelineName: string;
  subscriberName: string;
  durationMs: number;
}) =>
  esSubscriberDuration.labels(pipelineName, subscriberName).observe(durationMs);

// --- Process manager metrics ---
register.removeSingleMetric("es_process_manager_total");
const esProcessManagerTotal = new Counter({
  name: "es_process_manager_total",
  help: "Total number of process-manager evolutions",
  labelNames: ["process_name", "input_kind", "outcome"] as const,
});

export const incrementEsProcessManagerTotal = ({
  processName,
  inputKind,
  outcome,
}: {
  processName: string;
  inputKind: "event" | "wake";
  outcome:
    | "committed"
    | "duplicate_event"
    | "stale_wake"
    | "revision_conflict"
    | "failed";
}) => esProcessManagerTotal.labels(processName, inputKind, outcome).inc();

register.removeSingleMetric("es_process_manager_duration_milliseconds");
const esProcessManagerDuration = new Histogram({
  name: "es_process_manager_duration_milliseconds",
  help: "Duration of process-manager evolutions in milliseconds",
  labelNames: ["process_name", "input_kind"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
});

export const observeEsProcessManagerDuration = ({
  processName,
  inputKind,
  durationMs,
}: {
  processName: string;
  inputKind: "event" | "wake";
  durationMs: number;
}) =>
  esProcessManagerDuration.labels(processName, inputKind).observe(durationMs);

register.removeSingleMetric("es_process_outbox_total");
const esProcessOutboxTotal = new Counter({
  name: "es_process_outbox_total",
  help: "Total number of process-manager outbox delivery attempts",
  labelNames: ["process_name", "intent_type", "status"] as const,
});

export const incrementEsProcessOutboxTotal = ({
  processName,
  intentType,
  status,
}: {
  processName: string;
  intentType: string;
  status: "dispatched" | "retried" | "dead";
}) => esProcessOutboxTotal.labels(processName, intentType, status).inc();

register.removeSingleMetric("es_process_outbox_duration_milliseconds");
const esProcessOutboxDuration = new Histogram({
  name: "es_process_outbox_duration_milliseconds",
  help: "Duration of process-manager outbox delivery attempts in milliseconds",
  labelNames: ["process_name", "intent_type"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const observeEsProcessOutboxDuration = ({
  processName,
  intentType,
  durationMs,
}: {
  processName: string;
  intentType: string;
  durationMs: number;
}) =>
  esProcessOutboxDuration.labels(processName, intentType).observe(durationMs);

// How late a wake fires relative to the instant it was scheduled for
// (ADR-054): the direct answer to "is the scheduler stalling". Buckets run
// to hours because a wake surviving a fleet outage legitimately fires very
// late once — the ALERT is on sustained lag, not a single spike.
register.removeSingleMetric("es_process_wake_lag_milliseconds");
const esProcessWakeLag = new Histogram({
  name: "es_process_wake_lag_milliseconds",
  help: "Delay between a process wake's scheduled instant and it being handled",
  labelNames: ["process_name"] as const,
  buckets: [
    100, 1000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000, 21600000,
    86400000,
  ],
});

export const observeEsProcessWakeLag = ({
  processName,
  lagMs,
}: {
  processName: string;
  lagMs: number;
}) => esProcessWakeLag.labels(processName).observe(Math.max(0, lagMs));

// How long a committed intent sat in the outbox before its dispatch began
// (ADR-054): the direct answer to "is the outbox draining". Excludes retry
// waits by design — attempt > 1 rows re-enter with backoff, so only the
// first attempt measures pure queueing delay.
register.removeSingleMetric("es_process_outbox_dispatch_lag_milliseconds");
const esProcessOutboxDispatchLag = new Histogram({
  name: "es_process_outbox_dispatch_lag_milliseconds",
  help: "Delay between an intent being committed and its first dispatch starting",
  labelNames: ["process_name"] as const,
  buckets: [
    50, 250, 1000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000,
  ],
});

export const observeEsProcessOutboxDispatchLag = ({
  processName,
  lagMs,
}: {
  processName: string;
  lagMs: number;
}) => esProcessOutboxDispatchLag.labels(processName).observe(Math.max(0, lagMs));

// Commits whose intents were dropped as already-dispatched (ADR-054).
// Legitimate on event redelivery — but a sustained per-process rate is
// exactly how the ADR-051 lost-day scheduling bug hid, so it is measured,
// logged AND alertable rather than only logged.
register.removeSingleMetric("es_process_intents_suppressed_total");
const esProcessIntentsSuppressed = new Counter({
  name: "es_process_intents_suppressed_total",
  help: "Process-manager commits whose intents were suppressed as already-dispatched",
  labelNames: ["process_name"] as const,
});

export const incrementEsProcessIntentsSuppressed = ({
  processName,
  count,
}: {
  processName: string;
  count: number;
}) => esProcessIntentsSuppressed.labels(processName).inc(count);

// --- Topic clustering domain metrics (ADR-051/ADR-054) ---
// Run-page outcomes as the domain sees them, not just generic es_* counters:
// `failed_final` is the alertable one (retries exhausted, run_failed
// recorded); `failed_retryable` is expected noise under provider hiccups.
register.removeSingleMetric("topic_clustering_page_total");
const topicClusteringPageTotal = new Counter({
  name: "topic_clustering_page_total",
  help: "Topic clustering page executions by outcome",
  labelNames: ["outcome"] as const,
});

export const incrementTopicClusteringPageTotal = ({
  outcome,
}: {
  outcome: "completed" | "skipped" | "failed_retryable" | "failed_final";
}) => topicClusteringPageTotal.labels(outcome).inc();

register.removeSingleMetric("topic_clustering_page_duration_milliseconds");
const topicClusteringPageDuration = new Histogram({
  name: "topic_clustering_page_duration_milliseconds",
  help: "Duration of one topic clustering page (langevals call included)",
  labelNames: ["mode"] as const,
  // A page is embeddings + LLM naming over up to 2000 traces — minutes are
  // normal, and the outbox lease caps everything at 20.
  buckets: [1000, 5000, 15000, 30000, 60000, 120000, 300000, 600000, 1200000],
});

export const observeTopicClusteringPageDuration = ({
  mode,
  durationMs,
}: {
  mode: "batch" | "incremental";
  durationMs: number;
}) => topicClusteringPageDuration.labels(mode).observe(durationMs);

// --- Governance ingestion-pull domain metrics (ADR-054) ---
// Pull-run outcomes as the domain sees them, not just generic es_* counters:
// `failed_final` is the alertable one (retries exhausted, run_failed
// recorded); `failed_retryable` is expected noise under provider hiccups.
register.removeSingleMetric("ingestion_pull_total");
const ingestionPullTotal = new Counter({
  name: "ingestion_pull_total",
  help: "Governance ingestion pull executions by outcome",
  labelNames: ["outcome"] as const,
});

export const incrementIngestionPullTotal = ({
  outcome,
}: {
  outcome: "completed" | "failed_retryable" | "failed_final";
}) => ingestionPullTotal.labels(outcome).inc();

register.removeSingleMetric("ingestion_pull_duration_milliseconds");
const ingestionPullDuration = new Histogram({
  name: "ingestion_pull_duration_milliseconds",
  help: "Duration of one governance ingestion pull (adapter poll and OCSF sink writes)",
  // Unlabelled on purpose: the executor only knows the sourceId, and the
  // adapter kind lives behind the run port — no cheap low-cardinality label.
  // A pull is a network poll plus row inserts, capped by the worker's
  // 5-minute soft deadline, so buckets run 100ms to 5min.
  buckets: [100, 250, 500, 1000, 2500, 5000, 15000, 30000, 60000, 120000, 300000],
});

export const observeIngestionPullDuration = ({
  durationMs,
}: {
  durationMs: number;
}) => ingestionPullDuration.observe(durationMs);

// --- Fold cache metrics ---
register.removeSingleMetric("es_fold_cache_total");
const esFoldCacheTotal = new Counter({
  name: "es_fold_cache_total",
  help: "Total number of fold cache lookups",
  labelNames: ["projection_name", "result"] as const,
});

export const incrementEsFoldCacheTotal = (
  projectionName: string,
  result: "hit" | "miss" | "fallback_error",
) => esFoldCacheTotal.labels(projectionName, result).inc();

register.removeSingleMetric("es_fold_cache_get_duration_milliseconds");
const esFoldCacheGetDuration = new Histogram({
  name: "es_fold_cache_get_duration_milliseconds",
  help: "Duration of fold cache get operations in milliseconds",
  labelNames: ["projection_name", "source"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
});

export const observeEsFoldCacheGetDuration = (
  projectionName: string,
  source: "redis" | "clickhouse",
  durationMs: number,
) => esFoldCacheGetDuration.labels(projectionName, source).observe(durationMs);

register.removeSingleMetric("es_fold_cache_store_duration_milliseconds");
const esFoldCacheStoreDuration = new Histogram({
  name: "es_fold_cache_store_duration_milliseconds",
  help: "Duration of fold cache store operations in milliseconds",
  labelNames: ["projection_name"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500],
});

export const observeEsFoldCacheStoreDuration = (
  projectionName: string,
  durationMs: number,
) => esFoldCacheStoreDuration.labels(projectionName).observe(durationMs);

register.removeSingleMetric("es_fold_cache_redis_error_total");
const esFoldCacheRedisErrorTotal = new Counter({
  name: "es_fold_cache_redis_error_total",
  help: "Total number of Redis errors in fold cache operations",
  labelNames: ["projection_name", "operation"] as const,
});

export const incrementEsFoldCacheRedisError = (
  projectionName: string,
  operation: "get" | "set",
) => esFoldCacheRedisErrorTotal.labels(projectionName, operation).inc();

// ============================================================================
// Langy Metrics
// ============================================================================
//
// Operational counters for the Langy turn flow. Per-tenant / per-conversation
// attribution deliberately lives in the structured log lines next to each
// increment, never as labels (see the cardinality doctrine above) — these
// series answer "is Langy healthy fleet-wide?", the logs answer "which
// tenant?".

// One increment per turn-acceptance attempt at the admission boundary.
register.removeSingleMetric("langwatch_langy_turns_total");
const langyTurnsTotal = new Counter({
  name: "langwatch_langy_turns_total",
  help: "Langy turn-acceptance attempts by outcome at the admission boundary",
  labelNames: ["outcome"] as const,
});
export const getLangyTurnsCounter = (
  outcome: "accepted" | "replay" | "busy" | "rejected" | "error",
) => langyTurnsTotal.labels(outcome);

// One increment per dispatch attempt to the agent manager.
register.removeSingleMetric("langwatch_langy_dispatch_total");
const langyDispatchTotal = new Counter({
  name: "langwatch_langy_dispatch_total",
  help: "Langy turn dispatches to the agent manager by outcome",
  labelNames: ["outcome"] as const,
});
export const getLangyDispatchCounter = (
  outcome:
    | "accepted"
    | "busy"
    | "credentials_required"
    | "unavailable"
    | "error",
) => langyDispatchTotal.labels(outcome);

// One increment per durable turn-result ingested on /api/internal/langy.
register.removeSingleMetric("langwatch_langy_turn_results_total");
const langyTurnResultsTotal = new Counter({
  name: "langwatch_langy_turn_results_total",
  help: "Durable Langy turn results ingested from the agent manager by outcome",
  labelNames: ["outcome"] as const,
});
export const getLangyTurnResultsCounter = (outcome: "completed" | "failed") =>
  langyTurnResultsTotal.labels(outcome);

// Incremented from the relay's per-connection tally when a frame stream ends.
register.removeSingleMetric("langwatch_langy_relay_frames_total");
const langyRelayFramesTotal = new Counter({
  name: "langwatch_langy_relay_frames_total",
  help: "Langy relay frames by processing result, summed per stream at close",
  labelNames: ["result"] as const,
});
export const getLangyRelayFramesCounter = (
  result: "applied" | "duplicate" | "rejected" | "terminal",
) => langyRelayFramesTotal.labels(result);

// Session-key lifecycle: minted per turn (when no live worker holds one),
// revoked on turn end, reaped when the 6h TTL lapses.
register.removeSingleMetric("langwatch_langy_session_keys_total");
const langySessionKeysTotal = new Counter({
  name: "langwatch_langy_session_keys_total",
  help: "Langy session API keys by lifecycle operation",
  labelNames: ["op"] as const,
});
export const getLangySessionKeysCounter = (
  op: "minted" | "revoked" | "revoke_refused" | "reaped",
) => langySessionKeysTotal.labels(op);

// The message rate limit fails open on Redis trouble by design; a sustained
// fail_open rate is a Redis outage worth alerting on without log grepping.
register.removeSingleMetric("langwatch_langy_rate_limit_total");
const langyRateLimitTotal = new Counter({
  name: "langwatch_langy_rate_limit_total",
  help: "Langy message rate-limit decisions that were not plain allows",
  labelNames: ["outcome"] as const,
});
export const getLangyRateLimitCounter = (outcome: "rejected" | "fail_open") =>
  langyRateLimitTotal.labels(outcome);

// ============================================================================
// Fold redelivery
// ============================================================================

register.removeSingleMetric("es_fold_post_store_failure_total");
const esFoldPostStoreFailure = new Counter({
  name: "es_fold_post_store_failure_total",
  help: "Fold deliveries that threw after their state was durably stored, by stage",
  labelNames: ["projection_name", "stage"] as const,
});

/**
 * A fold threw *after* its state was already written durably.
 *
 * Queue delivery is at-least-once and the fold's state is stored before
 * reactors are dispatched, so anything that throws from that point fails the
 * job without un-writing it: the queue re-delivers events the store already
 * holds. Folds accumulate rather than being idempotent (trace summary does
 * `spanCount + 1` and sums cost), so the re-apply double-counts.
 *
 * Every other fold signal reports this as a plain failure, which is
 * indistinguishable from one that threw *before* the write and is therefore
 * harmless to retry. The two need opposite responses, so they need separate
 * counters.
 *
 * Rate against `es_fold_projection_total{status="failed"}` for the share of
 * fold failures that land in the dangerous half.
 */
export const incrementEsFoldPostStoreFailure = (
  projectionName: string,
  stage: "reactor_dispatch",
) => esFoldPostStoreFailure.labels(projectionName, stage).inc();

// ============================================================================
// Stored Objects Metrics
// ============================================================================

// Counter: total storeFromBytes calls (dedup hit + miss combined)
register.removeSingleMetric("stored_object_extract_total");
const storedObjectExtractTotal = new Counter({
  name: "stored_object_extract_total",
  help: "Total number of storeFromBytes calls, whether hit or miss",
  labelNames: ["purpose"] as const,
});

export const getStoredObjectExtractCounter = (purpose: string) =>
  storedObjectExtractTotal.labels(purpose);

// Counter: deduplication hits (content already present for this project)
register.removeSingleMetric("stored_object_dedup_hit_total");
const storedObjectDedupHitTotal = new Counter({
  name: "stored_object_dedup_hit_total",
  help: "Total storeFromBytes calls where content was already present (dedup hit)",
  labelNames: ["purpose"] as const,
});

export const getStoredObjectDedupHitCounter = (purpose: string) =>
  storedObjectDedupHitTotal.labels(purpose);

// Counter: PUT failures (storage backend rejected the write)
register.removeSingleMetric("stored_object_write_failures_total");
const storedObjectWriteFailuresTotal = new Counter({
  name: "stored_object_write_failures_total",
  help: "Total storeFromBytes calls where the storage put rejected the write",
  labelNames: ["purpose"] as const,
});

export const getStoredObjectWriteFailureCounter = (purpose: string) =>
  storedObjectWriteFailuresTotal.labels(purpose);

// Counter: GET failures (storage backend rejected the read)
register.removeSingleMetric("stored_object_read_failures_total");
const storedObjectReadFailuresTotal = new Counter({
  name: "stored_object_read_failures_total",
  help: "Total getById calls where the storage get rejected the read",
});

export const storedObjectReadFailureCounter = storedObjectReadFailuresTotal;

// Histogram: payload size observed on each storeFromBytes call
register.removeSingleMetric("stored_object_size_bytes");
const storedObjectSizeBytesHistogram = new Histogram({
  name: "stored_object_size_bytes",
  help: "Size of stored object payloads in bytes",
  labelNames: ["purpose"] as const,
  buckets: [
    128, // 0.125 KB
    1024, // 1 KB
    4096, // 4 KB
    16384, // 16 KB
    65536, // 64 KB
    262144, // 256 KB
    1048576, // 1 MB
    4194304, // 4 MB
    16777216, // 16 MB
  ],
});

export const getStoredObjectSizeBytesHistogram = (purpose: string) =>
  storedObjectSizeBytesHistogram.labels(purpose);

// ============================================================================
// withMetrics utility
// ============================================================================

/**
 * Wraps an async operation with timing, calling onComplete or onFail with the
 * elapsed duration in milliseconds. Re-throws on failure so callers still
 * observe the original error.
 */
export async function withMetrics<T>({
  fn,
  onComplete,
  onFail,
}: {
  fn: () => Promise<T>;
  onComplete: (durationMs: number) => void;
  onFail: (durationMs: number) => void;
}): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    onComplete(performance.now() - start);
    return result;
  } catch (error) {
    onFail(performance.now() - start);
    throw error;
  }
}

// =============================================================================
// Worker metrics HTTP listener port
// =============================================================================

/**
 * Worker metrics port follows PORT so non-default PORT slots (5570, 5580...)
 * don't all collide on 2999. PORT=5560 → 2999 (back-compat).
 */
const WORKER_METRICS_PORT_OFFSET = 2561;

export const DEFAULT_WORKER_METRICS_PORT = 2999;

const getDefaultWorkerMetricsPort = (): number => {
  const portString = process.env.PORT;
  if (portString === undefined || portString === "") {
    return DEFAULT_WORKER_METRICS_PORT;
  }
  const basePort = parseInt(portString, 10);
  if (Number.isNaN(basePort)) {
    return DEFAULT_WORKER_METRICS_PORT;
  }
  return basePort - WORKER_METRICS_PORT_OFFSET;
};

export const getWorkerMetricsPort = (): number => {
  const portString =
    process.env.WORKER_METRICS_PORT ?? String(getDefaultWorkerMetricsPort());
  const port = parseInt(portString, 10);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid WORKER_METRICS_PORT: "${portString}". Must be a number between 1 and 65535.`,
    );
  }

  return port;
};
