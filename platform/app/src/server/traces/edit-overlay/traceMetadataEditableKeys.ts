/**
 * Which of a trace's metadata keys a correction may touch, and how one of them
 * lines up with the row the drawer shows for it.
 *
 * The drawer reads the trace header, whose attribute map keeps the ingested
 * namespaces (`metadata.` for what the caller sent, `langwatch.` for what the
 * platform stamped), while a correction is written in the bare keys the
 * canonical trace metadata uses, which is what a dataset mapping reads. These
 * three functions are the only place the two spellings meet.
 */

/** Prefix the ingest path gives every metadata key the caller sent. */
const METADATA_ATTRIBUTE_PREFIX = "metadata.";

/** The attribute the trace's labels are stamped on. */
const LABELS_ATTRIBUTE = "langwatch.labels";

/** The metadata key those labels are read back as. */
const LABELS_METADATA_KEY = "labels";

/**
 * Metadata that decides where a trace belongs rather than what it contains.
 * A conversation, a user, a customer and a scenario run are assembled by
 * grouping traces on these, so correcting one would re-parent the trace, and a
 * correction read on top of the captured trace cannot re-parent anything.
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
 * The metadata key one summary attribute row corrects, or null when the row is
 * not the trace's own metadata at all.
 *
 * Three rows are: a `metadata.` prefixed key (what the caller sent), the labels
 * attribute, and a bare key. A dotted key in any other namespace
 * (`service.name`, `gen_ai.*`, `telemetry.*`) describes the run that produced
 * the trace rather than the trace, so it carries no correction.
 */
export function traceMetadataKeyForAttribute(
  attributeKey: string,
): string | null {
  const key = bareMetadataKey(attributeKey);
  if (key === null) return null;
  return isTraceMetadataKeyEditable(key) ? key : null;
}

function bareMetadataKey(attributeKey: string): string | null {
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
