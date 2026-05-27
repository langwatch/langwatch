import type { TraceBlobRef } from "./blob-store.service";

/**
 * Reserved-attribute prefix under which per-field blob references are carried
 * inside the span's `SpanAttributes` map. Using the established
 * `langwatch.reserved.*` namespace (cf. `langwatch.reserved.output_source`)
 * lets refs ride the generic attribute pipeline — no schema change to the
 * command/event/NormalizedSpan/projection layers, no separate column. ADR-021.
 *
 * Layout: `langwatch.reserved.blobref.<attrKey>` → JSON.stringify(TraceBlobRef),
 * with the original `<attrKey>` value replaced by a bounded preview.
 */
export const BLOB_REF_ATTR_PREFIX = "langwatch.reserved.blobref.";

/** Encode blob refs into reserved attributes so they flow through the pipeline. */
export function mergeBlobRefsIntoAttributes(
  attributes: Record<string, string>,
  blobRefs: Record<string, TraceBlobRef>,
): Record<string, string> {
  const out = { ...attributes };
  for (const [attrKey, ref] of Object.entries(blobRefs)) {
    out[`${BLOB_REF_ATTR_PREFIX}${attrKey}`] = JSON.stringify(ref);
  }
  return out;
}

/**
 * Split reserved blob-ref attributes back out of a span's attribute map.
 * Returns the user-facing attributes (reserved ref keys removed) plus the
 * decoded refs keyed by their original attrKey. Malformed ref JSON is skipped
 * defensively (the inline preview remains usable).
 */
export function extractBlobRefsFromAttributes(
  attributes: Record<string, string>,
): {
  attributes: Record<string, string>;
  blobRefs: Record<string, TraceBlobRef>;
} {
  const cleaned: Record<string, string> = {};
  const blobRefs: Record<string, TraceBlobRef> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith(BLOB_REF_ATTR_PREFIX)) {
      const attrKey = key.slice(BLOB_REF_ATTR_PREFIX.length);
      try {
        blobRefs[attrKey] = JSON.parse(value) as TraceBlobRef;
      } catch {
        // Malformed ref — leave it out; the preview in `attributes[attrKey]`
        // is still shown. Don't throw on read.
      }
    } else {
      cleaned[key] = value;
    }
  }
  return { attributes: cleaned, blobRefs };
}

/** True when the attribute map carries at least one offloaded-field ref. */
export function hasBlobRefs(attributes: Record<string, string>): boolean {
  for (const key in attributes) {
    if (key.startsWith(BLOB_REF_ATTR_PREFIX)) return true;
  }
  return false;
}
