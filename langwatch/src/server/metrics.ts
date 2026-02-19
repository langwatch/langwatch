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

// Histogram for collector index delay
register.removeSingleMetric("collector_index_delay_milliseconds");
export const collectorIndexDelayHistogram = new Histogram({
  name: "collector_index_delay_milliseconds",
  help: "Delay between a trace being received and being indexed",
  buckets: [
    100, 1000, 2000, 3000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000,
    600_000, 1_200_000, 3_600_000, 10_800_000,
  ],
});

type JobType =
  | "collector"
  | "collector_check_and_adjust"
  | "evaluations"
  | "track_events"
  | "topic_clustering"
  | "usage_stats"
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

// Gauge for checkpoint lag (number of unprocessed events)
register.removeSingleMetric("event_sourcing_checkpoint_lag");
const eventSourcingCheckpointLag = new Gauge({
  name: "event_sourcing_checkpoint_lag",
  help: "Number of unprocessed events (lag) for event sourcing processors",
  labelNames: ["pipeline_name", "processor_name", "processor_type"] as const,
});

export const setEventSourcingCheckpointLag = (
  pipelineName: string,
  processorName: string,
  processorType: string,
  lag: number,
) =>
  eventSourcingCheckpointLag
    .labels(pipelineName, processorName, processorType)
    .set(lag);

// Counter for lock contention events
register.removeSingleMetric("event_sourcing_lock_contention_total");
const eventSourcingLockContentionTotal = new Counter({
  name: "event_sourcing_lock_contention_total",
  help: "Total number of lock contention events in event sourcing",
  labelNames: ["pipeline_name", "processor_name"] as const,
});

export const getEventSourcingLockContentionCounter = (
  pipelineName: string,
  processorName: string,
) => eventSourcingLockContentionTotal.labels(pipelineName, processorName);
