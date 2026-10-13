/**
 * Maps metadata key spellings: attributes use `metadata.` (caller) and
 * `langwatch.` (platform) prefixes; corrections use bare keys. Three functions bridge.
 */

/** Prefix the ingest path gives every metadata key the caller sent. */
const METADATA_ATTRIBUTE_PREFIX = "metadata.";

/** The attribute the trace's labels are stamped on. */
const LABELS_ATTRIBUTE = "langwatch.labels";

/** The metadata key those labels are read back as. */
const LABELS_METADATA_KEY = "labels";

/**
 * Metadata that decides where a trace belongs, not what it contains.
 * Conversations, users, customers and scenario runs group traces on these,
 * so a correction read cannot re-parent anything.
 */
const GROUPING_METADATA_KEYS = new Set(["thread_id", "user_id", "customer_id"]);

/**
 * Namespaces the platform owns: `langwatch.` is everything it stamps itself
 * (the whole `langwatch.reserved.` namespace included), and `scenario.` carries
 * the ids a simulation run is assembled from.
 */
const PLATFORM_METADATA_PREFIXES = ["langwatch.", "scenario."];

/**
 * Whether a correction may replace this metadata key. Written against the bare
 * canonical key, so it holds wherever the key came from.
 */
export function isTraceMetadataKeyEditable(key: string): boolean {
  if (key.length === 0) return false;
  if (GROUPING_METADATA_KEYS.has(key)) return false;
  return !PLATFORM_METADATA_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Metadata key one summary attribute row corrects (filtering out run-describing
 * attributes like service.name, gen_ai.*, telemetry.*).
 */
export function mapAttributeToTraceMetadataKey(attributeKey: string): string | null {
  const key = extractBareMetadataKey(attributeKey);
  if (key === null) return null;
  return isTraceMetadataKeyEditable(key) ? key : null;
}

function extractBareMetadataKey(attributeKey: string): string | null {
  if (attributeKey === LABELS_ATTRIBUTE) return LABELS_METADATA_KEY;
  if (attributeKey.startsWith(METADATA_ATTRIBUTE_PREFIX)) {
    const bare = attributeKey.slice(METADATA_ATTRIBUTE_PREFIX.length);
    return bare.length > 0 ? bare : null;
  }
  return attributeKey.includes(".") ? null : attributeKey;
}

/** The summary attribute row a corrected metadata key reads on. */
export function traceAttributeKeyForMetadata(key: string): string {
  if (key === LABELS_METADATA_KEY) return LABELS_ATTRIBUTE;
  return `${METADATA_ATTRIBUTE_PREFIX}${key}`;
}
