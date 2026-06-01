/**
 * Queue configuration constants.
 *
 * All queue names and job names defined here to ensure consistency
 * between queue creation and worker registration.
 *
 * All queue names MUST use makeQueueName() to wrap them in Redis Cluster
 * hash tags. See makeQueueName.ts for details.
 */

import { makeQueueName } from "./makeQueueName";

/** Collector queue - processes incoming trace data */
export const COLLECTOR_QUEUE = {
  NAME: makeQueueName("collector"),
  JOB: "collector",
} as const;

/** Evaluations queue - runs LLM evaluations on traces */
export const EVALUATIONS_QUEUE = {
  NAME: makeQueueName("evaluations"),
  // Job name is dynamic (evaluator type), not a constant
} as const;

/** Topic clustering queue - groups traces by topic */
export const TOPIC_CLUSTERING_QUEUE = {
  NAME: makeQueueName("topic_clustering"),
  JOB: "topic_clustering",
} as const;

/** Usage stats queue - collects usage statistics */
export const USAGE_STATS_QUEUE = {
  NAME: makeQueueName("usage_stats"),
  JOB: "usage_stats",
} as const;

/**
 * Anomaly detection queue - evaluates active AnomalyRules against the
 * governance_kpis fold (3b) on a scheduled tick (every 5 minutes by
 * default). Spec: anomaly-rules.feature + anomaly-detection.feature.
 */
export const ANOMALY_DETECTION_QUEUE = {
  NAME: makeQueueName("anomaly_detection"),
  JOB: "anomaly_detection",
} as const;

/**
 * Pull-mode ingestion source poller — drives the PullerAdapter
 * framework. Each IngestionSource with `pullSchedule` set has a
 * BullMQ repeat job that fires `runOnce` and persists the resulting
 * cursor + events. Spec:
 * specs/ai-governance/puller-framework/puller-adapter-contract.feature.
 */
export const PULLER_QUEUE = {
  NAME: makeQueueName("ingestion_puller"),
  JOB: "ingestion_puller",
} as const;

/**
 * Data-retention orphan-sweep tick — sweeps dangling PG rows whose
 * underlying CH trace rows have aged out via retention TTL. The
 * ingestion reactor only fires for active tenants; this tick catches
 * tenants that have stopped ingesting but whose CH rows are still
 * being deleted by ClickHouse TTL.
 */
export const DATA_RETENTION_ORPHAN_SWEEP_QUEUE = {
  NAME: makeQueueName("data_retention_orphan_sweep"),
  JOB: "data_retention_orphan_sweep",
} as const;

