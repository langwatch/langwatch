/**
 * Reserved metadata keys mapped to their filter URL keys.
 */
const metadataKeyToUrlKey: Record<string, string> = {
  user_id: "user_id",
  thread_id: "thread_id",
  customer_id: "customer_id",
  labels: "labels",
  prompt_ids: "prompt_id",
};

/**
 * Builds filter params for a metadata tag click.
 *
 * @param key - The metadata key.
 * @param value - The display value (may be comma-joined for arrays).
 * @param originalValue - The original value from trace metadata.
 * @returns Filter params to be merged into URL query.
 */
export function buildMetadataFilterParams(
  key: string,
  value: string,
  originalValue: unknown,
): Record<string, string> {
  if (key === "trace_id") {
    return { query: `trace_id:${value}` };
  }

  const urlKey = metadataKeyToUrlKey[key];
  if (urlKey) {
    const filterValue =
      Array.isArray(originalValue) && originalValue.length > 0
        ? String(originalValue[0])
        : value;
    return { [urlKey]: filterValue };
  }

  // Custom metadata: use middle dot for keys with dots
  // metadata.value filter requires nested structure: metadata.{key}=value
  const urlSafeKey = key.replaceAll(".", "·");
  return {
    metadata_key: urlSafeKey,
    [`metadata.${urlSafeKey}`]: value,
  };
}
