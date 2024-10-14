import { Counter, Histogram, register } from "prom-client";

type Endpoint =
  | "collector"
  | "log_steps"
  | "log_results"
  | "dataset"
  | "dataset_record"
  | "topic_clustering_batch"
  | "topic_clustering_incremental";

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
  | "evaluation"
  | "track_event"
  | "topic_clustering";
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

// Histogram for evaluation duration
register.removeSingleMetric("job_processing_duration_milliseconds");
export const jobProcessingDurationHistogram = new Histogram({
  name: "job_processing_duration_milliseconds",
  help: "Duration of jobs in milliseconds",
  labelNames: ["job_type"] as const,
  buckets: [
    10, 20, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400,
    1600, 1800, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 7500, 10000,
  ],
});

export const getJobProcessingDurationHistogram = (jobType: JobType) =>
  jobProcessingDurationHistogram.labels(jobType);

// Histogram for evaluation duration
register.removeSingleMetric("evaluation_duration_milliseconds");
export const evaluationDurationHistogram = new Histogram({
  name: "evaluation_duration_milliseconds",
  help: "Duration of evaluations in milliseconds",
  labelNames: ["evaluator_type"] as const,
  buckets: [
    10, 20, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400,
    1600, 1800, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 7500, 10000,
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
