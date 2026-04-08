import { performance } from "node:perf_hooks";
import { Counter, Gauge, Histogram, register, collectDefaultMetrics } from "prom-client";

// Enable default metrics collection (heap, stack, GC, etc.)
if (!register.getSingleMetric("process_cpu_user_seconds_total")) {
  collectDefaultMetrics({ register });
}

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
  | "scenario";

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
// BullMQ Queue Metrics
// ============================================================================

export type BullMQQueueState =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "delayed"
  | "paused"
  | "prioritized"
  | "waiting-children";

// Gauge for BullMQ job counts by state (from getJobCounts())
register.removeSingleMetric("bullmq_job_total");
const bullmqJobTotal = new Gauge({
  name: "bullmq_job_total",
  help: "Total number of jobs in the queue by state",
  labelNames: ["queue_name", "state"] as const,
});

export const setBullMQJobCount = (
  queueName: string,
  state: BullMQQueueState,
  count: number,
) => bullmqJobTotal.labels(queueName, state).set(count);

// Histogram for job wait time (time from enqueue to processing start)
register.removeSingleMetric("bullmq_job_wait_duration_milliseconds");
export const bullmqJobWaitDurationHistogram = new Histogram({
  name: "bullmq_job_wait_duration_milliseconds",
  help: "Time jobs spend waiting in queue before processing starts",
  labelNames: ["queue_name"] as const,
  buckets: [
    10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000,
    300000,
  ],
});

export const getBullMQJobWaitDurationHistogram = (queueName: string) =>
  bullmqJobWaitDurationHistogram.labels(queueName);

export function recordJobWaitDuration(
  job: { timestamp?: number },
  queueName: string,
): void {
  if (job.timestamp) {
    getBullMQJobWaitDurationHistogram(queueName).observe(
      Date.now() - job.timestamp,
    );
  }
}

// Counter for stalled jobs
register.removeSingleMetric("bullmq_job_stalled_total");
const bullmqJobStalledTotal = new Counter({
  name: "bullmq_job_stalled_total",
  help: "Total number of jobs that have stalled",
  labelNames: ["queue_name"] as const,
});

export const getBullMQJobStalledCounter = (queueName: string) =>
  bullmqJobStalledTotal.labels(queueName);

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

export const incrementEsFoldProjectionTotal = (
  pipelineName: string,
  projectionName: string,
  status: ESStatus,
) => esFoldProjectionTotal.labels(pipelineName, projectionName, status).inc();

register.removeSingleMetric("es_fold_projection_duration_milliseconds");
const esFoldProjectionDuration = new Histogram({
  name: "es_fold_projection_duration_milliseconds",
  help: "Duration of fold projection execution in milliseconds",
  labelNames: ["pipeline_name", "projection_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const observeEsFoldProjectionDuration = (
  pipelineName: string,
  projectionName: string,
  durationMs: number,
) =>
  esFoldProjectionDuration
    .labels(pipelineName, projectionName)
    .observe(durationMs);

// --- Map projection metrics ---
register.removeSingleMetric("es_map_projection_total");
const esMapProjectionTotal = new Counter({
  name: "es_map_projection_total",
  help: "Total number of map projection executions",
  labelNames: ["pipeline_name", "projection_name", "status"] as const,
});

export const incrementEsMapProjectionTotal = (
  pipelineName: string,
  projectionName: string,
  status: ESStatus,
) => esMapProjectionTotal.labels(pipelineName, projectionName, status).inc();

register.removeSingleMetric("es_map_projection_duration_milliseconds");
const esMapProjectionDuration = new Histogram({
  name: "es_map_projection_duration_milliseconds",
  help: "Duration of map projection execution in milliseconds",
  labelNames: ["pipeline_name", "projection_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
});

export const observeEsMapProjectionDuration = (
  pipelineName: string,
  projectionName: string,
  durationMs: number,
) =>
  esMapProjectionDuration
    .labels(pipelineName, projectionName)
    .observe(durationMs);

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
  status: ESStatus,
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
