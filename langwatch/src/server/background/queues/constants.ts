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
 * Per-tenant orphan-sweep chain — a self-perpetuating BullMQ chain that
 * sweeps dangling PG rows whose underlying CH trace rows have been TTL'd.
 *
 * Lifecycle:
 *   - Seeded by the ingestion reactor (first ingest per tenant).
 *   - Each chain step sweeps, then re-enqueues itself with a 24h delay via
 *     the worker's `completed` listener — that's why this is an event
 *     chain, not a cron.
 *   - Stops when the project is archived or hard-deleted; the worker
 *     simply doesn't re-enqueue.
 *   - Stable jobId per tenant gives natural dedup: bursty ingest only
 *     ever holds one job per tenant in the queue.
 */
export const ORPHAN_SWEEP_CHAIN_QUEUE = {
  NAME: makeQueueName("orphan_sweep_chain"),
  JOB: "orphan_sweep_chain",
} as const;
