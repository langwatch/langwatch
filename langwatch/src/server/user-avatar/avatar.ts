/**
 * Pure helpers + constants for user-uploaded avatars.
 *
 * A user's avatar is platform-level identity (it renders wherever a person is
 * shown, across every project the user touches), so it is deliberately NOT
 * tied to the tenant/project stored-objects taxonomy the way trace media is.
 * We still reuse the stored-objects byte machinery, but tag the object with a
 * dedicated purpose and a user owner, and serve it through a route that any
 * authenticated user can read (see src/app/api/user-avatar).
 *
 * This module holds only pure logic (constants, data-URL parsing/validation,
 * URL construction) so it is trivially unit-testable without storage or DB.
 *
 * Spec: specs/settings/user-avatar.feature
 */

/** The stored-object "purpose" tag for user avatars. */
export const AVATAR_PURPOSE = "user_avatar";

/** The stored-object owner kind for user avatars — the owner is a User, not a project. */
export const AVATAR_OWNER_KIND = "user";

/**
 * Hard cap on the bytes an avatar upload may take, server-side. The client
 * crops + downscales to a small square first, so a stored avatar is only a few
 * KB–tens of KB; 8 MB is the ceiling we accept — matching LinkedIn's
 * profile-photo limit — and the same limit the client enforces on the picked
 * file (see AVATAR_MAX_SOURCE_BYTES).
 */
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Upper bound on the raw `data:` URL length we accept, so an oversized payload
 * is rejected before the regex scans it or any Buffer is allocated. base64
 * inflates bytes by 4/3; the extra 256 covers the `data:<type>;base64,` prefix
 * and any incidental whitespace. Used both here and by the tRPC input schema
 * (`user.setAvatar`) as a first-line `.max()` guard.
 */
export const AVATAR_MAX_DATA_URL_LENGTH =
  Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 256;

/**
 * Image types we accept on upload. Every entry must also be readback-safe
 * (`isReadbackSafe` in stored-objects/safe-media-types.ts) so the serve route
 * can echo the Content-Type without coercing it to octet-stream.
 */
export const AVATAR_ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type AvatarMediaType = (typeof AVATAR_ALLOWED_MEDIA_TYPES)[number];

export type AvatarValidationCode =
  | "invalid_data_url"
  | "invalid_type"
  | "empty"
  | "file_too_large"
  | "content_mismatch";

/**
 * Thrown by {@link parseAvatarDataUrl} for any caller-fixable problem with the
 * uploaded payload. The tRPC layer maps this to a BAD_REQUEST with a message
 * the settings UI can show verbatim.
 */
export class AvatarValidationError extends Error {
  constructor(
    readonly code: AvatarValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "AvatarValidationError";
  }
}

// The base64 group is `*` (not `+`) so an empty payload (`data:image/png;base64,`)
// still matches here and is reported as the more specific `empty` error below,
// rather than the generic `invalid_data_url`.
const DATA_URL_RE =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/i;

function isAllowedMediaType(mediaType: string): mediaType is AvatarMediaType {
  return (AVATAR_ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/**
 * Per-type magic-byte signature checks, keyed by the declared media type.
 *
 * Defense-in-depth: the checks above only validate the client-declared type in
 * the `data:` prefix, so without this a caller who bypasses the browser's
 * canvas re-encode (e.g. calling `user.setAvatar` directly) could tag
 * arbitrary bytes as `image/png` and use avatar storage as an untyped blob
 * store. The response headers (`nosniff` + a `sandbox` CSP) already prevent
 * the bytes from ever executing as active content regardless, so this check
 * protects data integrity, not the XSS boundary.
 */
const MAGIC_BYTE_CHECKS: Record<AvatarMediaType, (bytes: Buffer) => boolean> = {
  "image/png": (bytes) =>
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a,
  "image/jpeg": (bytes) =>
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff,
  "image/gif": (bytes) =>
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString("latin1") === "GIF87a" ||
      bytes.subarray(0, 6).toString("latin1") === "GIF89a"),
  "image/webp": (bytes) =>
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP",
};

/**
 * Parses and validates a base64 image data URL (e.g. produced by the client
 * canvas resize step) into raw bytes + media type.
 *
 * @throws {AvatarValidationError} on a malformed data URL, a disallowed image
 *   type, empty bytes, a payload over {@link AVATAR_MAX_BYTES}, or decoded
 *   bytes whose magic-byte signature doesn't match the declared type.
 */
export function parseAvatarDataUrl(dataUrl: string): {
  mediaType: AvatarMediaType;
  bytes: Buffer;
} {
  const trimmed = dataUrl.trim();
  // Reject an oversized payload up front — before the regex scans it or any
  // Buffer is decoded — so a huge user-controlled string can't allocate memory
  // just to be rejected. The precise decoded-size check still runs below.
  if (trimmed.length > AVATAR_MAX_DATA_URL_LENGTH) {
    throw new AvatarValidationError(
      "file_too_large",
      `Image is too large (max ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB).`,
    );
  }

  const match = DATA_URL_RE.exec(trimmed);
  if (!match) {
    throw new AvatarValidationError(
      "invalid_data_url",
      "Expected a base64-encoded image data URL.",
    );
  }

  const mediaType = match[1]!.toLowerCase();
  if (!isAllowedMediaType(mediaType)) {
    throw new AvatarValidationError(
      "invalid_type",
      `Unsupported image type "${mediaType}". Allowed: ${AVATAR_ALLOWED_MEDIA_TYPES.join(", ")}.`,
    );
  }

  // Strip any embedded whitespace/newlines the encoder may have inserted so
  // the byte-length check reflects real decoded size, not base64 padding.
  const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  if (bytes.length === 0) {
    throw new AvatarValidationError("empty", "The image is empty.");
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    throw new AvatarValidationError(
      "file_too_large",
      `Image is too large (max ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB).`,
    );
  }

  if (!MAGIC_BYTE_CHECKS[mediaType](bytes)) {
    throw new AvatarValidationError(
      "content_mismatch",
      `The file's content doesn't match its declared type (${mediaType}).`,
    );
  }

  return { mediaType, bytes };
}

/**
 * Resolves the Content-Type an avatar HTTP response may echo verbatim.
 *
 * Pinned directly to {@link AVATAR_ALLOWED_MEDIA_TYPES} rather than the
 * broader stored-objects `isReadbackSafe` (which passes the whole `image/`
 * prefix family, including `image/svg+xml`). The avatar serve route is
 * readable by any authenticated user platform-wide (see
 * src/app/api/user-avatar), so its Content-Type allowlist stays independently
 * pinned to exactly the four types this module accepts on upload — a future
 * widening of the general stored-objects allowlist can never widen what this
 * route serves inline.
 */
export function safeAvatarMediaType(mediaType: string): string {
  return isAllowedMediaType(mediaType) ? mediaType : "application/octet-stream";
}

/**
 * Builds the same-origin, authenticated URL persisted to `User.image` and
 * rendered directly in every avatar `<img src>`. Carries both the project the
 * bytes live under (needed for the content-addressed `getById`) and the
 * stored-object id. The serve route re-checks the object's purpose + owner, so
 * the embedded projectId is not a trust boundary.
 */
export function buildAvatarUrl({
  projectId,
  id,
}: {
  projectId: string;
  id: string;
}): string {
  return `/api/user-avatar/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}`;
}
