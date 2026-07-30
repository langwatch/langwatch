import { canonicalLogRecordSchema } from "./schema";

/**
 * `prefix` keeps the derived type string byte-equal to
 * `lw.obs.log.record_received`, which is already in `event_log`.
 */
export const LOG_PIPELINE_NAME = "log";
export const LOG_PIPELINE_PREFIX = "lw.obs";

/**
 * A log record has no lifecycle: nothing about it changes after it arrives,
 * so there is exactly one event and no state to fold (ADR-105).
 */
export const logProcessingEvents = {
  recordReceived: canonicalLogRecordSchema,
} as const;
