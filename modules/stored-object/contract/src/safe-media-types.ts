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

/**
 * Media types a browser can execute. Files are served from our own origin, so
 * an upload of one is refused at create for every uploadable purpose.
 */
export const REFUSED_ATTACHMENT_MEDIA_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
] as const;

/** True for a media type a browser can run, compared without parameters or case. */
export function isRefusedUploadMediaType(mediaType: string): boolean {
  const base = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (REFUSED_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(base);
}
