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

