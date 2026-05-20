/**
 * safe-media-types.ts — single source of truth for the stored-objects
 * MIME allowlist.
 *
 * Two consumers must agree on what media types are "safe to serve inline":
 *  - The content-extractor (ingest path) — refuse to store types that the
 *    read path cannot faithfully serve.
 *  - The files-route (read path) — downgrade anything outside the list to
 *    `application/octet-stream` to neutralize stored-XSS primitives.
 *
 * Keeping the list here means a future widening of either surface stays in
 * sync with the other automatically.
 */

/**
 * Media-type prefixes that are served verbatim on the read path.
 * All subtypes of these families (e.g. `audio/mp3`, `image/png`) pass.
 */
export const SAFE_MEDIA_TYPE_PREFIXES = [
  "audio/",
  "image/",
  "video/",
] as const;

/**
 * Exact media types served verbatim on the read path in addition to the
 * prefix families above.
 */
export const SAFE_MEDIA_TYPES_EXACT = new Set([
  "application/pdf",
]);

/**
 * Returns `true` when the read path (`/api/files/:id`) will serve the given
 * `mediaType` with its original Content-Type header.
 *
 * Returns `false` for any type the read path would downgrade to
 * `application/octet-stream` — storing such a type at ingest would break
 * round-trip fidelity silently.
 */
export function isReadbackSafe(mediaType: string): boolean {
  if (SAFE_MEDIA_TYPES_EXACT.has(mediaType)) return true;
  if (SAFE_MEDIA_TYPE_PREFIXES.some((p) => mediaType.startsWith(p))) return true;
  return false;
}
