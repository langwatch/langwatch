import { Counter, Histogram, register } from "prom-client";
import { performance } from 'node:perf_hooks';

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
  buckets: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
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
  | "evaluation"
  | "track_event"
  | "topic_clustering"
  | "usage_stats";

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
  status: EvaluationStatus
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
