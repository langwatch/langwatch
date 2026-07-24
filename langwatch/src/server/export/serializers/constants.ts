/**
 * Shared constants for trace export serializers.
 */

/**
 * Metadata keys that are already represented as dedicated columns
 * and should be excluded from the generic "metadata" field.
 *
 * Used by both CSV and JSON serializers to ensure consistent output
 * regardless of export format.
 */
export const RESERVED_METADATA_KEYS = new Set([
  "thread_id",
  "user_id",
  "customer_id",
  "labels",
  "topic_id",
  "subtopic_id",
  "sdk_name",
  "sdk_version",
  "sdk_language",
  "telemetry_sdk_language",
  "telemetry_sdk_name",
  "telemetry_sdk_version",
  "prompt_ids",
  "prompt_version_ids",
]);
