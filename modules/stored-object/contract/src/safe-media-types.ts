/**
 * MIME allowlist: single source of truth for ingest (refuse unsafe) and read
 * (downgrade unsafe) paths to stay in sync on what's safe to serve inline.
 */

/**
 * Media-type prefixes that are served verbatim on the read path.
 * All subtypes of these families (e.g. `audio/mp3`, `image/png`) pass.
 */
export const SAFE_MEDIA_TYPE_PREFIXES = ["audio/", "image/", "video/"] as const;

/**
 * Exact media types served verbatim on the read path in addition to the
 * prefix families above.
 */
export const SAFE_MEDIA_TYPES_EXACT = new Set(["application/pdf"]);

/**
 * Mirrors `/api/files/:id`: unsafe types become `application/octet-stream`, so
 * accepting one at ingest would silently break round-trip fidelity.
 */
export function isReadbackSafe(mediaType: string): boolean {
  if (SAFE_MEDIA_TYPES_EXACT.has(mediaType)) return true;
  const hasSafePrefix = SAFE_MEDIA_TYPE_PREFIXES.some((p) => mediaType.startsWith(p));
  if (hasSafePrefix) return true;
  return false;
}
