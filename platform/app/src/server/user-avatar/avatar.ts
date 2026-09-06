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

import { HandledError } from "@langwatch/handled-error";

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
 * and any incidental whitespace.
 *
 * Enforced here and nowhere else on purpose. `user.setAvatar`'s input schema
 * used to carry the same number as a `.max()`, which meant zod always won the
 * race and an oversized photo came back as the anonymous `validation_error`
 * instead of `avatar_image_too_large` — the specific code both halves of this
 * check are supposed to answer with. The guard below runs before the regex or
 * any Buffer allocation, so it costs the schema nothing to stay out of it.
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

/**
 * Why the payload was unreadable. A machine sub-classifier for logs and tests,
 * never prose: all three read the same to a customer ("pick another file"), and
 * telling them the magic bytes disagreed with the declared MIME type is not
 * something they can act on.
 */
export type AvatarUnreadableReason =
  | "invalid_data_url"
  | "empty"
  | "content_mismatch";

/**
 * Thrown by {@link parseAvatarDataUrl} for any caller-fixable problem with the
 * uploaded payload. Catch the family with `AvatarValidationError.is(err)`.
 *
 * Handled errors, so they cross the tRPC boundary as their code and the
 * settings UI renders the registry's copy — `message` here is server copy for a
 * log line. Before this it was a bespoke `Error` with a parallel `code` field
 * that the router flattened into a BAD_REQUEST carrying the raw message, which
 * is the second code system ADR-045 exists to prevent.
 *
 * One subclass per code rather than a code argument, matching every other
 * handled error in the codebase — and matching what `codes.unit.test.ts` can
 * see, since it reads declared codes and cannot follow a constructor argument.
 */
export abstract class AvatarValidationError extends HandledError {}

/** Payload is over {@link AVATAR_MAX_BYTES}, before or after decoding. */
export class AvatarTooLargeError extends AvatarValidationError {
  declare readonly code: "avatar_image_too_large";

  constructor() {
    super("avatar_image_too_large", "Avatar data URL is over the ceiling", {
      meta: { maxBytes: AVATAR_MAX_BYTES },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AvatarTooLargeError";
  }
}

/** A real image, but not one of {@link AVATAR_ALLOWED_MEDIA_TYPES}. */
export class AvatarTypeUnsupportedError extends AvatarValidationError {
  declare readonly code: "avatar_image_type_unsupported";

  constructor(mediaType: string) {
    super(
      "avatar_image_type_unsupported",
      `Avatar declared an unsupported media type: ${mediaType}`,
      {
        meta: { allowed: [...AVATAR_ALLOWED_MEDIA_TYPES] },
        httpStatus: 400,
        fault: "customer",
      },
    );
    this.name = "AvatarTypeUnsupportedError";
  }
}

/** Not a readable image: malformed data URL, empty, or mismatched bytes. */
export class AvatarUnreadableError extends AvatarValidationError {
  declare readonly code: "avatar_image_unreadable";

  constructor(reason: AvatarUnreadableReason, message: string) {
    super("avatar_image_unreadable", message, {
      meta: { reason },
      httpStatus: 400,
      fault: "customer",
    });
    this.name = "AvatarUnreadableError";
  }
}

/**
 * The caller changed their photo too many times in a short window.
 *
 * Not an {@link AvatarValidationError} — nothing is wrong with the payload,
 * and the remedy is time rather than a different file — but handled all the
 * same: "you did this too often, wait and retry" is a cause we can name and an
 * action the caller can take, which is exactly the bar ADR-045 sets. As a bare
 * TRPCError it reached the customer as the generic unknown state.
 *
 * `fault: "customer"` because the caller's own rate is what tripped it; the
 * 429 is the limiter working, not an incident.
 */
export class AvatarRateLimitedError extends HandledError {
  declare readonly code: "avatar_rate_limited";

  constructor() {
    super("avatar_rate_limited", "Too many avatar updates for this user", {
      httpStatus: 429,
      fault: "customer",
    });
    this.name = "AvatarRateLimitedError";
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
    throw new AvatarTooLargeError();
  }

  const match = DATA_URL_RE.exec(trimmed);
  if (!match) {
    throw new AvatarUnreadableError(
      "invalid_data_url",
      "Avatar payload is not a base64 image data URL",
    );
  }

  const mediaType = match[1]!.toLowerCase();
  if (!isAllowedMediaType(mediaType)) {
    throw new AvatarTypeUnsupportedError(mediaType);
  }

  // Strip any embedded whitespace/newlines the encoder may have inserted so
  // the byte-length check reflects real decoded size, not base64 padding.
  const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  if (bytes.length === 0) {
    throw new AvatarUnreadableError(
      "empty",
      "Avatar payload decoded to zero bytes",
    );
  }
  if (bytes.length > AVATAR_MAX_BYTES) {
    throw new AvatarTooLargeError();
  }

  if (!MAGIC_BYTE_CHECKS[mediaType](bytes)) {
    throw new AvatarUnreadableError(
      "content_mismatch",
      `Avatar bytes do not match the declared media type: ${mediaType}`,
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
