import { canonicalMetricDataPointSchema } from "./schema";

/**
 * `prefix` keeps the derived type string byte-equal to
 * `lw.obs.metric.data_point_received`, which is already in `event_log`.
 */
export const METRIC_PIPELINE_NAME = "metric";
export const METRIC_PIPELINE_PREFIX = "lw.obs";

/**
 * A metric data point is immutable and content-addressed — `pointId` hashes
 * the point's own canonical payload — so every point is its own aggregate of
 * exactly one event and nothing folds this state (ADR-105).
 */
export const metricProcessingEvents = {
  dataPointReceived: canonicalMetricDataPointSchema,
} as const;
