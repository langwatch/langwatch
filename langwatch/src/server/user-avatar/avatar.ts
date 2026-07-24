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

/** stored_objects.purpose tag for user avatars. */
export const AVATAR_PURPOSE = "user_avatar";

/** stored_objects.owner_kind for user avatars — the owner is a User, not a project. */
export const AVATAR_OWNER_KIND = "user";

/**
 * Max accepted avatar payload, server-side. The client crops + downscales to a
 * small square before upload, so a real avatar is a few KB–tens of KB; 2 MB is
 * generous headroom that still rejects an un-resized full-resolution photo.
 */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

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
  | "file_too_large";

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
const DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]*)$/i;

function isAllowedMediaType(mediaType: string): mediaType is AvatarMediaType {
  return (AVATAR_ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/**
 * Parses and validates a base64 image data URL (e.g. produced by the client
 * canvas resize step) into raw bytes + media type.
 *
 * @throws {AvatarValidationError} on a malformed data URL, a disallowed image
 *   type, empty bytes, or a payload over {@link AVATAR_MAX_BYTES}.
 */
export function parseAvatarDataUrl(dataUrl: string): {
  mediaType: AvatarMediaType;
  bytes: Buffer;
} {
  const match = DATA_URL_RE.exec(dataUrl.trim());
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

  return { mediaType, bytes };
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
