/**
 * Shared constants for trace export serializers.
 */

/**
 * Metadata keys already represented as dedicated columns, excluded from
 * the generic "metadata" field. Used by both CSV and JSON serializers for
 * consistent output.
 */
export const RESERVED_METADATA_KEYS: Readonly<Record<string, true>> = {
  thread_id: true,
  user_id: true,
  customer_id: true,
  labels: true,
  topic_id: true,
  subtopic_id: true,
  sdk_name: true,
  sdk_version: true,
  sdk_language: true,
  telemetry_sdk_language: true,
  telemetry_sdk_name: true,
  telemetry_sdk_version: true,
  prompt_ids: true,
  prompt_version_ids: true,
};
