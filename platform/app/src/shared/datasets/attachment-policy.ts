/**
 * What a dataset attachment may be: how big, and of which media type.
 *
 * Browser safe on purpose. The upload button has to refuse an oversized file
 * before it spends a minute sending it, and the route has to refuse the same
 * file when the request arrives, so both sides read the same numbers from here
 * rather than each carrying their own copy.
 */

/** The largest file a dataset cell accepts. Matches the NLP engine's own cap. */
export const DATASET_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Headroom over {@link DATASET_ATTACHMENT_MAX_BYTES} for the multipart framing
 * that wraps the file on the wire: the part headers, the boundaries and the
 * other form fields. Without it a file of exactly the maximum size arrives as a
 * body slightly over the cap and is refused for its envelope rather than for
 * its content.
 */
export const DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES = 1024 * 1024;

/** The body cap the upload route applies to the whole multipart request. */
export const DATASET_ATTACHMENT_REQUEST_MAX_BYTES =
  DATASET_ATTACHMENT_MAX_BYTES + DATASET_ATTACHMENT_MULTIPART_SLACK_BYTES;

/** The media type used when the upload declares none. */
export const DATASET_ATTACHMENT_DEFAULT_MEDIA_TYPE = "application/octet-stream";

/**
 * Media types a browser can execute.
 *
 * Attachments are served from our own origin, so a stored page or script that
 * a browser runs would run with the origin's privileges. The read path already
 * serves anything outside its own allowlist as a download, and refusing these
 * at upload time means such a file never reaches the store in the first place.
 */
export const REFUSED_ATTACHMENT_MEDIA_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
] as const;

/**
 * The media type to store for a part that declares `declared`.
 *
 * Drops the parameters a browser appends (`; charset=utf-8`), lower-cases the
 * result, and falls back to
 * {@link DATASET_ATTACHMENT_DEFAULT_MEDIA_TYPE} when the part declares nothing.
 */
export function normalizeAttachmentMediaType(
  declared: string | undefined | null,
): string {
  const base = (declared ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "" ? DATASET_ATTACHMENT_DEFAULT_MEDIA_TYPE : base;
}

/** True for a media type a browser can run, which an upload never accepts. */
export function isRefusedAttachmentMediaType(mediaType: string): boolean {
  return (REFUSED_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(
    normalizeAttachmentMediaType(mediaType),
  );
}
