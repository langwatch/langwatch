/**
 * Queue configuration constants.
 *
 * All queue names and job names defined here to ensure consistency
 * between queue creation and worker registration.
 *
 * The {curly braces} in queue names are Redis Cluster hash tags.
 * They ensure all BullMQ keys for a queue land on the same Redis node.
 */

/** Collector queue - processes incoming trace data */
export const COLLECTOR_QUEUE = {
  NAME: "{collector}",
  JOB: "collector",
} as const;

/** Evaluations queue - runs LLM evaluations on traces */
export const EVALUATIONS_QUEUE = {
  NAME: "{evaluations}",
  // Job name is dynamic (evaluator type), not a constant
} as const;

/** Topic clustering queue - groups traces by topic */
export const TOPIC_CLUSTERING_QUEUE = {
  NAME: "{topic_clustering}",
  JOB: "topic_clustering",
} as const;

/** Track events queue - processes analytics events */
export const TRACK_EVENTS_QUEUE = {
  NAME: "{track_events}",
  JOB: "track_events",
} as const;

/** Usage stats queue - collects usage statistics */
export const USAGE_STATS_QUEUE = {
  NAME: "{usage_stats}",
  JOB: "usage_stats",
} as const;
