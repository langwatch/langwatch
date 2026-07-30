import {
  requestedDataSchema,
  runCompletedDataSchema,
  runFailedDataSchema,
  runStartedDataSchema,
  topicsRecordedDataSchema,
} from "./schema";

/** `prefix` is what makes every derived type string byte-equal the ones already
 * in `event_log` (e.g. `lw.obs.topic_clustering.run_started`). */
export const TOPIC_CLUSTERING_PIPELINE_NAME = "topic_clustering";
export const TOPIC_CLUSTERING_PIPELINE_PREFIX = "lw.obs";

export const topicClusteringEvents = {
  requested: requestedDataSchema,
  runStarted: runStartedDataSchema,
  runCompleted: runCompletedDataSchema,
  runFailed: runFailedDataSchema,
  topicsRecorded: topicsRecordedDataSchema,
} as const;
